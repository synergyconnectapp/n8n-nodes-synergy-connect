import type { IDataObject, IHookFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError, sleep } from 'n8n-workflow';
import { apiRequest, pathPart, type ApiResponse, type RequestOptions } from '../../SynergyConnect/v1/transport';

export interface HookEntry {
	id: string;
	secret: string;
}

interface WebhookRow {
	id: string;
	url: string;
	name?: string | null;
	fields?: string[];
	statuses?: string[] | null;
	instanceIds?: string[] | null;
}

export const NAME_PREFIX = 'n8n · ';
const MAX_RETRY_AFTER_SECONDS = 60;

// `staticData.hooks[<webhook url>] = { id, secret }`: BY URL, so the production and the test URL of one workflow never
// overwrite each other (E1-11).
export function hooksOf(ctx: IHookFunctions): Record<string, HookEntry> {
	const data = ctx.getWorkflowStaticData('node');
	if (!data.hooks || typeof data.hooks !== 'object') data.hooks = {};
	return data.hooks as Record<string, HookEntry>;
}

export function readHooks(staticData: IDataObject): Record<string, HookEntry> {
	return (staticData.hooks as Record<string, HookEntry> | undefined) ?? {};
}

const PRIVATE_V4 =
	/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

// The API refuses these too, but only answers "the URL must be a public address".
export function assertPublicHttpsUrl(ctx: IHookFunctions, url: string): void {
	const node = ctx.getNode();
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new NodeOperationError(node, 'The webhook URL of n8n is not a valid URL.');
	}
	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (parsed.protocol !== 'https:') {
		throw new NodeOperationError(node, 'The webhook URL of n8n must use https.', {
			description: `n8n would receive events at ${url}. Set the WEBHOOK_URL environment variable of n8n to a public https address (a tunnel works for tests).`,
		});
	}
	if (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host.endsWith('.internal') ||
		PRIVATE_V4.test(host) ||
		host === '::1' ||
		host === '::' ||
		/^f[cd][0-9a-f]{2}:/.test(host) ||
		/^fe[89ab][0-9a-f]:/.test(host)
	) {
		throw new NodeOperationError(node, 'The webhook URL of n8n points to a private address: Synergy Connect cannot reach it.', {
			description: `n8n would receive events at ${url}. Set the WEBHOOK_URL environment variable of n8n to a public https address (a tunnel works for tests).`,
		});
	}
}

function webhookName(ctx: IHookFunctions): string {
	const workflow = ctx.getWorkflow();
	const suffix = ctx.getMode() === 'manual' ? 'test' : 'prod';
	const tail = ` · ${suffix}`;
	const label = String(workflow.name ?? workflow.id ?? 'workflow');
	return `${NAME_PREFIX}${label.slice(0, 60 - NAME_PREFIX.length - tail.length)}${tail}`;
}

// What the node asks of the server: `fields`, the status filter and the numbers (null = all of the key).
export function desiredSubscription(ctx: IHookFunctions) {
	const events = ctx.getNodeParameter('events', []) as string[];
	const advanced = ctx.getNodeParameter('advancedEvents', []) as string[];
	const fields = [...new Set([...events, ...advanced])];
	const statuses = ctx.getNodeParameter('statusFilter', []) as string[];
	const numbers = ctx.getNodeParameter('phoneNumbers', []) as string[];
	return {
		fields,
		statuses: fields.includes('statuses') && statuses.length > 0 ? statuses : null,
		instanceIds: numbers.length > 0 ? numbers : null,
	};
}

const sameSet = (a: string[] | null | undefined, b: string[] | null | undefined) =>
	(a ?? []).slice().sort().join('\u0000') === (b ?? []).slice().sort().join('\u0000');

// The management API allows 30 calls a minute: one 429 is waited out (Retry-After up to 60 s), once.
async function managed(
	ctx: IHookFunctions,
	options: Omit<RequestOptions, 'scope'>,
	wait: (ms: number) => Promise<void>,
): Promise<ApiResponse> {
	try {
		return await apiRequest(ctx, { ...options, scope: 'management' });
	} catch (error) {
		const e = error as { httpCode?: string; retryAfter?: number };
		const seconds = e.retryAfter ?? MAX_RETRY_AFTER_SECONDS;
		if (e.httpCode !== '429' || seconds > MAX_RETRY_AFTER_SECONDS) {
			throw new NodeApiError(ctx.getNode(), error as JsonObject);
		}
		await wait(seconds * 1000);
		return await apiRequest(ctx, { ...options, scope: 'management' });
	}
}

export async function listWebhooks(ctx: IHookFunctions, wait = sleep): Promise<WebhookRow[]> {
	const response = await managed(ctx, { method: 'GET', path: '/v1/webhooks' }, wait);
	return ((response.body as IDataObject).data as unknown as WebhookRow[]) ?? [];
}

async function syncSubscription(ctx: IHookFunctions, row: WebhookRow, wait: (ms: number) => Promise<void>) {
	const want = desiredSubscription(ctx);
	if (
		sameSet(row.fields, want.fields) &&
		sameSet(row.statuses, want.statuses) &&
		sameSet(row.instanceIds, want.instanceIds)
	) {
		return;
	}
	await managed(
		ctx,
		{
			method: 'PATCH',
			path: `/v1/webhooks/${pathPart(row.id)}`,
			body: { fields: want.fields, statuses: want.statuses, instanceIds: want.instanceIds, enabled: true },
		},
		wait,
	);
}

// Is there a webhook for THIS url? If it is ours, make sure we hold its secret (no second endpoint on a restart).
export async function checkExists(ctx: IHookFunctions, wait = sleep): Promise<boolean> {
	const url = ctx.getNodeWebhookUrl('default') as string;
	const hooks = hooksOf(ctx);
	const row = (await listWebhooks(ctx, wait)).find((w) => w.url === url);

	if (!row) {
		delete hooks[url];
		return false;
	}
	const known = hooks[url];
	if (known?.secret && known.id === row.id) {
		await syncSubscription(ctx, row, wait);
		return true;
	}
	if (typeof row.name === 'string' && row.name.startsWith(NAME_PREFIX)) {
		const rotated = await managed(
			ctx,
			{ method: 'POST', path: `/v1/webhooks/${pathPart(row.id)}/rotate-secret` },
			wait,
		);
		const secret = (rotated.body as IDataObject).secret;
		if (typeof secret !== 'string' || !secret) {
			throw new NodeOperationError(ctx.getNode(), 'Synergy Connect did not return the new webhook secret.');
		}
		hooks[url] = { id: row.id, secret };
		await syncSubscription(ctx, row, wait);
		return true;
	}
	throw new NodeOperationError(
		ctx.getNode(),
		'A webhook for this n8n URL already exists and was not created by n8n.',
		{
			description:
				'Delete it in the Synergy Connect app (Configurações → API e webhooks → Webhooks), then activate the workflow again.',
		},
	);
}

export async function createHook(ctx: IHookFunctions, wait = sleep): Promise<boolean> {
	const url = ctx.getNodeWebhookUrl('default') as string;
	assertPublicHttpsUrl(ctx, url);
	const hooks = hooksOf(ctx);
	// The API proves the URL with a signed ping DURING this call, before we know the secret: no stale entry may stand
	// in for it (the node answers that ping without running the workflow).
	delete hooks[url];

	const want = desiredSubscription(ctx);
	const response = await managed(
		ctx,
		{
			method: 'POST',
			path: '/v1/webhooks',
			body: {
				url,
				name: webhookName(ctx),
				fields: want.fields,
				statuses: want.statuses,
				instanceIds: want.instanceIds,
				verification: 'ping',
			},
		},
		wait,
	);
	const body = response.body as IDataObject;
	const id = (body.row as IDataObject | undefined)?.id;
	if (typeof id !== 'string' || typeof body.secret !== 'string' || !body.secret) {
		throw new NodeOperationError(ctx.getNode(), 'Synergy Connect did not return the webhook id and secret.');
	}
	hooks[url] = { id, secret: body.secret };
	return true;
}

export async function deleteHook(ctx: IHookFunctions, wait = sleep): Promise<boolean> {
	const url = ctx.getNodeWebhookUrl('default') as string;
	const hooks = hooksOf(ctx);
	const known = hooks[url];
	if (!known?.id) return true;
	try {
		await managed(ctx, { method: 'DELETE', path: `/v1/webhooks/${pathPart(known.id)}` }, wait);
	} catch (error) {
		// already gone is fine; the entry of THIS url is the only one dropped
		if ((error as { httpCode?: string }).httpCode !== '404') return false;
	}
	delete hooks[url];
	return true;
}
