import type { IDataObject, ILoadOptionsFunctions, INodeProperties } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { SynergyConnectApi } from '../credentials/SynergyConnectApi.credentials';
import { SynergyConnectV1 } from '../nodes/SynergyConnect/v1/SynergyConnectV1.node';
import {
	DEFAULT_BASE_URL,
	DEFAULT_GRAPH_VERSION,
	GRAPH_VERSION_PATTERN,
	PHONE_NUMBER_ID_PATTERN,
} from '../nodes/SynergyConnect/v1/transport';
import { SynergyConnectTriggerV1 } from '../nodes/SynergyConnectTrigger/v1/SynergyConnectTriggerV1.node';
import { checkExists, createHook, deleteHook } from '../nodes/SynergyConnectTrigger/v1/lifecycle';
import { EVENT_LABELS } from '../nodes/SynergyConnectTrigger/v1/outputs';
import { routeEnvelope } from '../nodes/SynergyConnectTrigger/v1/routing';
import { TOLERANCE_SECONDS, verifySignature } from '../nodes/SynergyConnectTrigger/v1/signature';
import {
	CREDENTIALS,
	HOOK_URL,
	SIGNATURE_EXAMPLE,
	TIMESTAMPED_SIGNATURE_EXAMPLE,
	executeContext,
	fakeHttp,
	hookContext,
	type FakeApiCall,
} from './helpers';

// The contract: every HTTP call of the two nodes is an operation of the OpenAPI document of the Synergy Connect API,
// with its method, path, query, headers and body; the events of the trigger are the ones a webhook can subscribe to;
// and the signature is the one the document describes. The document comes, in this order, from:
//   OPENAPI_FILE  a local openapi.json;
//   OPENAPI_URL   a published one;
//   neither       the server code of the monorepo this package lives in (src/api/public/openapi.ts), when it is there.
// A copy of the package alone, with no document, skips the suite. The file is linted with the rules of the nodes (no
// `fs`, no `process`), so the environment and the files come through vitest: `import.meta.env` and `import()`.

type Schema = { [keyword: string]: unknown };
interface Parameter {
	name: string;
	in: 'path' | 'query' | 'header';
	required?: boolean;
	schema: Schema;
}
interface Operation {
	operationId: string;
	security?: Record<string, string[]>[];
	parameters?: (Parameter | { $ref: string })[];
	requestBody?: { content: Record<string, { schema: Schema; examples?: Record<string, { value: unknown }> }> };
	responses: Record<string, { content?: Record<string, { schema: Schema; examples?: Record<string, { value: unknown }> }> }>;
}
interface Doc {
	servers: { url: string }[];
	paths: Record<string, Record<string, Operation>>;
	webhooks: Record<string, { post: Operation }>;
	components: {
		securitySchemes: Record<string, { type: string; scheme: string; bearerFormat: string }>;
		parameters: Record<string, Parameter>;
		schemas: Record<string, Schema>;
	};
	'x-webhook-delivery': {
		headers: { name: string }[];
		idempotency: { header: string };
		signature: {
			example: { secret: string; body: string; header: string };
			timestamped: {
				header: string;
				toleranceSeconds: number;
				example: { secret: string; body: string; deliveryId: string; t: number; header: string };
			};
		};
	};
}

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
// one loader when the package sits in the monorepo, none in a copy of the package alone
const localSources = Object.values(import.meta.glob<{ openapi: Doc }>('../../../src/api/public/openapi.ts'));

async function loadDocument(): Promise<Doc | null> {
	const { OPENAPI_FILE, OPENAPI_URL } = env;
	if (OPENAPI_FILE) {
		// absolute, or relative to the root of the package
		const file = new URL(OPENAPI_FILE, new URL('../', import.meta.url)).href;
		return ((await import(/* @vite-ignore */ file)) as { default: Doc }).default;
	}
	if (OPENAPI_URL) {
		const res = await fetch(OPENAPI_URL);
		if (!res.ok) throw new Error(`GET ${OPENAPI_URL} → ${res.status}`);
		return (await res.json()) as Doc;
	}
	if (localSources.length > 0) {
		// what the API would publish: through JSON, as the document is served
		return JSON.parse(JSON.stringify((await localSources[0]()).openapi)) as Doc;
	}
	return null;
}

// ── a JSON Schema check, for the keywords the document uses ─────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const typeOf = (value: unknown) =>
	value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;

function deref(doc: Doc, ref: string): Schema {
	const schema = doc.components.schemas[ref.replace('#/components/schemas/', '')];
	if (!schema) throw new Error(`the document has no ${ref}`);
	return schema;
}

function validate(doc: Doc, schema: Schema, value: unknown, at: string): string[] {
	if (typeof schema.$ref === 'string') return validate(doc, deref(doc, schema.$ref), value, at);
	const errors: string[] = [];
	const types = schema.type === undefined ? [] : ([] as string[]).concat(schema.type as string | string[]);
	const actual = typeOf(value);
	if (types.length > 0 && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
		return [`${at} is ${actual}, the document says ${types.join(' | ')}`];
	}
	if ('const' in schema && value !== schema.const) errors.push(`${at} must be ${JSON.stringify(schema.const)}`);
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
		errors.push(`${at} is ${JSON.stringify(value)}, not one of ${JSON.stringify(schema.enum)}`);
	}
	if (typeof value === 'string') {
		if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
			errors.push(`${at} "${value}" does not match ${schema.pattern}`);
		}
		if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${at} is too short`);
		if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${at} is too long`);
		if (schema.format === 'uuid' && !UUID.test(value)) errors.push(`${at} "${value}" is not a uuid`);
	}
	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${at} is below ${schema.minimum}`);
		if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${at} is above ${schema.maximum}`);
	}
	if (Array.isArray(value)) {
		if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${at} has too few items`);
		if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${at} has too many items`);
		if (schema.items) value.forEach((v, i) => errors.push(...validate(doc, schema.items as Schema, v, `${at}[${i}]`)));
	}
	if (actual === 'object') {
		const object = value as Record<string, unknown>;
		const properties = (schema.properties ?? {}) as Record<string, Schema>;
		for (const key of (schema.required ?? []) as string[]) {
			if (object[key] === undefined) errors.push(`${at}.${key} is required and missing`);
		}
		for (const [key, v] of Object.entries(object)) {
			if (v === undefined) continue;
			if (properties[key]) errors.push(...validate(doc, properties[key], v, `${at}.${key}`));
			else if (schema.additionalProperties === false) errors.push(`${at}.${key} is not a field of the document`);
			else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
				errors.push(...validate(doc, schema.additionalProperties as Schema, v, `${at}.${key}`));
			}
		}
	}
	for (const keyword of ['oneOf', 'anyOf']) {
		const branches = schema[keyword] as Schema[] | undefined;
		if (!branches) continue;
		// with a discriminator, only the alternative it names is tried: the message is about that one
		const discriminator = schema.discriminator as { propertyName: string; mapping?: Record<string, string> } | undefined;
		const tag = discriminator && actual === 'object' ? (value as IDataObject)[discriminator.propertyName] : undefined;
		const named = typeof tag === 'string' ? discriminator?.mapping?.[tag] : undefined;
		const results = (named ? [{ $ref: named }] : branches).map((branch) => validate(doc, branch, value, at));
		if (results.some((r) => r.length === 0)) continue;
		errors.push(
			...(results.length === 1
				? results[0]
				: [`${at} matches no alternative of the document: ${results.map((r) => r[0]).join(' | ')}`]),
		);
	}
	return errors;
}

// ── a call of the node against the document ─────────────────────────────────────────────────────────────

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const parametersOf = (doc: Doc, operation: Operation): Parameter[] =>
	(operation.parameters ?? []).map((p) =>
		'$ref' in p ? doc.components.parameters[p.$ref.replace('#/components/parameters/', '')] : p,
	);

interface Checked {
	// `METHOD /path/{template} → operationId`, or what was called when the document has no such operation
	operation: string;
	scopes: string[] | null;
	problems: string[];
}

// The operations a call can be: the method, the path, and every id of the path in the format the document gives it.
function operationsFor(doc: Doc, call: Pick<FakeApiCall, 'method' | 'url'>) {
	const segments = new URL(call.url).pathname.split('/').map(decodeURIComponent);
	return Object.entries(doc.paths).flatMap(([path, item]) => {
		const operation = item[call.method.toLowerCase()];
		const template = path.split('/');
		if (!operation || !METHODS.includes(call.method.toLowerCase()) || template.length !== segments.length) return [];
		const parameters = parametersOf(doc, operation);
		const fits = template.every((part, i) => {
			const name = /^\{(.+)\}$/.exec(part)?.[1];
			if (!name) return part === segments[i];
			const parameter = parameters.find((p) => p.in === 'path' && p.name === name);
			return !!parameter && validate(doc, parameter.schema, segments[i], name).length === 0;
		});
		return fits ? [{ path, operation, parameters }] : [];
	});
}

function checkCall(doc: Doc, call: FakeApiCall): Checked {
	const url = new URL(call.url);
	const called = `${call.method} ${url.pathname}`;
	const problems: string[] = [];
	if (url.search) problems.push('the query must go in `qs`, not in the URL');

	const matches = operationsFor(doc, call);
	if (matches.length !== 1) {
		return {
			operation: called,
			scopes: null,
			problems: [`${matches.length} operations of the document match ${called} (method, path and the format of its ids)`],
		};
	}
	const [{ path, operation, parameters }] = matches;

	const query = parameters.filter((p) => p.in === 'query');
	for (const [name, value] of Object.entries(call.qs ?? {})) {
		const parameter = query.find((p) => p.name === name);
		if (!parameter) problems.push(`query "${name}" is not a parameter of the operation`);
		else problems.push(...validate(doc, parameter.schema, value, `query ${name}`));
	}
	for (const p of query) {
		if (p.required && (call.qs ?? {})[p.name] === undefined) problems.push(`query "${p.name}" is required and missing`);
	}

	const headers = parameters.filter((p) => p.in === 'header');
	for (const [name, value] of Object.entries(call.headers ?? {})) {
		const parameter = headers.find((p) => p.name.toLowerCase() === name.toLowerCase());
		if (!parameter) problems.push(`header "${name}" is not a parameter of the operation`);
		else problems.push(...validate(doc, parameter.schema, value, `header ${name}`));
	}
	for (const p of headers) {
		const sent = Object.keys(call.headers ?? {}).some((name) => name.toLowerCase() === p.name.toLowerCase());
		if (p.required && !sent) problems.push(`header "${p.name}" is required and missing`);
	}

	const content = operation.requestBody?.content;
	if (!content) {
		if (call.body !== undefined) problems.push('sends a body, and the operation has none');
	} else if (content['multipart/form-data']) {
		const schema = content['multipart/form-data'].schema;
		const properties = (schema.properties ?? {}) as Record<string, Schema>;
		if (!(call.body instanceof FormData)) problems.push('the body must be multipart/form-data');
		else {
			const form = call.body;
			for (const key of new Set(form.keys())) {
				const value = form.get(key);
				if (!properties[key]) problems.push(`form field "${key}" is not a field of the operation`);
				else if (properties[key].format === 'binary') {
					if (typeof value === 'string') problems.push(`form field "${key}" must be a file`);
				} else problems.push(...validate(doc, properties[key], value, `form field ${key}`));
			}
			for (const key of (schema.required ?? []) as string[]) {
				if (!form.has(key)) problems.push(`form field "${key}" is required and missing`);
			}
		}
	} else if (call.body === undefined || call.body instanceof FormData) {
		problems.push('the body must be JSON');
	} else {
		problems.push(
			...validate(doc, content['application/json'].schema, JSON.parse(JSON.stringify(call.body)), 'body'),
		);
	}

	const security = operation.security?.[0];
	return {
		operation: `${call.method} ${path} → ${operation.operationId}`,
		scopes: security ? (Object.values(security)[0] ?? []) : [],
		problems,
	};
}

// What the API answers, by the document: the first example of the 2xx answer of the operation (a file when the
// answer is not JSON). The nodes run against these answers.
function documentedAnswer(doc: Doc, call: FakeApiCall): { statusCode?: number; headers?: Record<string, string>; body?: unknown } {
	const [match] = operationsFor(doc, call);
	const status = Object.keys(match?.operation.responses ?? {}).find((s) => s.startsWith('2'));
	if (!match || !status) return {};
	const json = match.operation.responses[status].content?.['application/json'];
	if (!json) return { statusCode: Number(status), headers: { 'content-type': 'image/png' }, body: new ArrayBuffer(4) };
	return { statusCode: Number(status), body: Object.values(json.examples ?? {})[0]?.value ?? {} };
}

// A field the node reads from an answer (`data[].id`, `row.id`…) must be a field of the 2xx answer of the operation.
function answerHas(doc: Doc, operationId: string, field: string): boolean {
	const operation = Object.values(doc.paths)
		.flatMap((item) => Object.values(item))
		.find((o) => o.operationId === operationId);
	const status = Object.keys(operation?.responses ?? {}).find((s) => s.startsWith('2'));
	let schema = status ? operation?.responses[status].content?.['application/json']?.schema : undefined;
	for (const part of field.split('.')) {
		if (schema && typeof schema.$ref === 'string') schema = deref(doc, schema.$ref);
		const [, key, list] = /^([^[]+)(\[\])?$/.exec(part) ?? [];
		schema = (schema?.properties as Record<string, Schema> | undefined)?.[key];
		if (schema && typeof schema.$ref === 'string') schema = deref(doc, schema.$ref);
		if (list) schema = schema?.items as Schema | undefined;
	}
	return schema !== undefined;
}

const doc = await loadDocument();

// ── every call the two nodes make ───────────────────────────────────────────────────────────────────────

// the scope each call asks for in its error texts, in the order of the calls
const recorded = vi.hoisted(() => ({ scopes: [] as string[] }));
vi.mock('../nodes/SynergyConnect/v1/transport', async (original) => {
	const transport = await original<typeof import('../nodes/SynergyConnect/v1/transport')>();
	const apiRequest: typeof transport.apiRequest = async (ctx, options) => {
		recorded.scopes.push(options.scope);
		return await transport.apiRequest(ctx, options);
	};
	return { ...transport, apiRequest };
});

type Handler = Parameters<typeof fakeHttp>[0];
interface Scenario {
	name: string;
	start: () => { calls: FakeApiCall[]; state?: IDataObject; done: () => Promise<unknown> };
}

const documented: Handler = (call) => (doc ? documentedAnswer(doc, call) : {});

const BASE = { displayName: '', icon: 'file:synergyConnect.svg' as const, description: '' };
const action = new SynergyConnectV1({ ...BASE, name: 'synergyConnect', group: ['transform'] });
const trigger = new SynergyConnectTriggerV1({ ...BASE, name: 'synergyConnectTrigger', group: ['trigger'] });

const NUMBER = '106540352242922';
const CUSTOMER = '5511999999999';
const MEDIA = '1166846181421424';
const TEMPLATE = '594425479261596';
const HOOK = '7c1f0c7e-4b53-4c7b-9a51-3f6f0a2d9e10';
const INSTANCE = '3f9a1c0b7d2e4a6f8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a';
const WEBHOOK_SECRET = 'e'.repeat(32);

const execute = (name: string, params: IDataObject): Scenario => ({
	name,
	start: () => {
		const [resource, operation] = name.split('.');
		const { ctx, calls } = executeContext({
			handler: documented,
			params: { resource, operation, phoneNumberId: { mode: 'id', value: NUMBER }, ...params },
		});
		return { calls, done: () => action.execute.call(ctx) };
	},
});

// the editor asking a node for a list (listSearch, loadOptions)
const list = (name: string, method: (this: ILoadOptionsFunctions) => Promise<unknown>): Scenario => ({
	name,
	start: () => {
		const http = fakeHttp(documented);
		const ctx = {
			getNode: () => ({ name: 'Synergy Connect', typeVersion: 1 }),
			getCredentials: async () => CREDENTIALS,
			getCurrentNodeParameter: () => NUMBER,
			helpers: { httpRequestWithAuthentication: http.request },
		} as unknown as ILoadOptionsFunctions;
		return { calls: http.calls, done: () => method.call(ctx) };
	},
});

const hook = (
	name: string,
	method: typeof createHook,
	options: Omit<Parameters<typeof hookContext>[0], 'handler'> & { handler?: Handler },
): Scenario => ({
	name,
	start: () => {
		const { ctx, calls, staticData } = hookContext({ handler: documented, ...options });
		return { calls, state: staticData, done: () => method(ctx, async () => {}) };
	},
});

const sent = { messageOptions: { repliesGoTo: 'queue', idempotencyKey: 'order-42' }, to: CUSTOMER };
const link = { mediaSource: 'link', mediaLink: 'https://example.com/file' };
const subscription = { events: ['messages', 'statuses'], statusFilter: ['delivered'], phoneNumbers: [INSTANCE] };
// the webhook of the document's list, as the one this trigger created: at its URL and with its name
const listing: Handler = (call) => {
	const answer = documented(call);
	if (call.method !== 'GET') return answer;
	const [row] = (answer.body as { data: IDataObject[] }).data;
	return { body: { data: [{ ...row, id: HOOK, url: HOOK_URL, name: 'n8n · Atendimento · prod', fields: ['messages'] }] } };
};

const scenarios: Scenario[] = [
	execute('message.sendText', { ...sent, text: 'Hello', previewUrl: true }),
	execute('message.sendImage', { ...sent, ...link, caption: 'A caption' }),
	execute('message.sendVideo', { ...sent, ...link }),
	execute('message.sendAudio', { ...sent, mediaSource: 'id', mediaId: MEDIA, voice: true }),
	execute('message.sendDocument', { ...sent, ...link, filename: 'invoice.pdf' }),
	execute('message.sendSticker', { ...sent, ...link }),
	execute('message.sendLocation', { ...sent, latitude: '-23.5505', longitude: '-46.6333', locationName: 'Store' }),
	execute('message.sendContacts', {
		...sent,
		contacts: { contactValues: [{ formattedName: 'Maria Souza', firstName: 'Maria', phone: '+5511988887777', phoneType: 'WORK' }] },
	}),
	execute('message.sendTemplate', {
		...sent,
		template: 'order_update::pt_BR',
		headerVariable: 'Maria',
		bodyVariables: { values: [{ value: '#42' }] },
	}),
	execute('message.sendButtons', {
		...sent,
		buttonsBody: 'Confirm?',
		buttonsHeader: 'Order',
		buttonsFooter: 'Synergy Connect',
		buttons: { buttonValues: [{ buttonId: 'yes', buttonTitle: 'Yes' }] },
	}),
	execute('message.sendList', {
		...sent,
		listBody: 'Choose',
		listButton: 'Options',
		listSections: { sectionValues: [{ sectionTitle: 'Section', rows: '[{"id":"row_1","title":"Option 1"}]' }] },
	}),
	execute('message.sendReaction', { ...sent, reactionMessageId: 'wamid.X', reactionEmoji: '👍' }),
	execute('message.sendRaw', { ...sent, rawBody: `{"to":"${CUSTOMER}","type":"text","text":{"body":"Hello"}}` }),
	execute('message.markAsRead', { readMessageId: 'wamid.X' }),
	execute('media.upload', { binaryPropertyName: 'data', mimeType: '' }),
	execute('media.get', { mediaId: MEDIA }),
	execute('media.download', { mediaId: MEDIA }),
	execute('media.delete', { mediaId: MEDIA }),
	execute('template.getAll', {
		returnAll: false,
		limit: 20,
		simplify: true,
		filters: { status: 'APPROVED', name: 'order', language: 'pt_BR' },
	}),
	execute('template.get', { templateId: TEMPLATE }),
	execute('template.create', {
		tplName: 'order_update',
		tplLanguage: 'pt_BR',
		tplCategory: 'UTILITY',
		tplBody: 'Hello {{1}}',
		tplBodyExamples: 'Maria',
	}),
	execute('template.update', { templateId: TEMPLATE, tplBody: 'Hello {{1}}', tplUpdateCategory: 'MARKETING' }),
	execute('template.delete', { templateId: TEMPLATE }),
	execute('template.uploadExample', { binaryPropertyName: 'data', mimeType: '' }),
	execute('conversation.handOff', { waId: CUSTOMER }),
	execute('flow.sendFlow', {
		to: CUSTOMER,
		flowId: '1234567890',
		flowBody: 'Fill the form',
		flowCta: 'Open',
		flowFooter: 'Synergy Connect',
		flowScreen: 'START',
		flowScreenData: '{"order":"42"}',
		flowContext: '{"order":"42"}',
	}),
	list('action.listSearch.searchNumbers', action.methods.listSearch.searchNumbers),
	list('action.loadOptions.getTemplates', action.methods.loadOptions.getTemplates),
	list('trigger.loadOptions.getInstances', trigger.methods.loadOptions.getInstances),
	hook('trigger.create', createHook, { params: subscription }),
	hook('trigger.checkExists (the state was lost: the secret is rotated)', checkExists, { handler: listing }),
	hook('trigger.checkExists (the events changed: the subscription is updated)', checkExists, {
		params: subscription,
		staticData: { hooks: { [HOOK_URL]: { id: HOOK, secret: WEBHOOK_SECRET } } },
		handler: listing,
	}),
	hook('trigger.delete', deleteHook, {
		staticData: { hooks: { [HOOK_URL]: { id: HOOK, secret: WEBHOOK_SECRET } } },
	}),
];

// What each scenario must call. A new call of the node, or another route, changes this table on purpose.
const SEND = 'POST /{version}/{phone_number_id}/messages → sendMessage';
const TEMPLATES = '/v1/numbers/{phone_number_id}/templates';
const EXPECTED: Record<string, string[]> = {
	'message.sendText': [SEND],
	'message.sendImage': [SEND],
	'message.sendVideo': [SEND],
	'message.sendAudio': [SEND],
	'message.sendDocument': [SEND],
	'message.sendSticker': [SEND],
	'message.sendLocation': [SEND],
	'message.sendContacts': [SEND],
	'message.sendTemplate': [SEND],
	'message.sendButtons': [SEND],
	'message.sendList': [SEND],
	'message.sendReaction': [SEND],
	'message.sendRaw': [SEND],
	'message.markAsRead': [SEND],
	'media.upload': ['POST /{version}/{phone_number_id}/media → uploadMedia'],
	'media.get': ['GET /{version}/{media_id} → getMedia'],
	'media.download': ['GET /{version}/{media_id}/download → downloadMedia'],
	'media.delete': ['DELETE /{version}/{media_id} → deleteMedia'],
	'template.getAll': [`GET ${TEMPLATES} → listTemplates`],
	'template.get': [`GET ${TEMPLATES}/{template_id} → getTemplate`],
	'template.create': [`POST ${TEMPLATES} → createTemplate`],
	'template.update': [`POST ${TEMPLATES}/{template_id} → updateTemplate`],
	'template.delete': [`DELETE ${TEMPLATES}/{template_id} → deleteTemplate`],
	'template.uploadExample': [`POST ${TEMPLATES}/media → uploadTemplateMedia`],
	'conversation.handOff': ['POST /v1/numbers/{phone_number_id}/handoff → handoffConversation'],
	'flow.sendFlow': ['POST /v1/numbers/{phone_number_id}/flows/{flow_id}/token → createFlowToken', SEND],
	'action.listSearch.searchNumbers': ['GET /v1/numbers → listNumbers'],
	'action.loadOptions.getTemplates': [`GET ${TEMPLATES} → listTemplates`],
	'trigger.loadOptions.getInstances': ['GET /v1/numbers → listNumbers'],
	'trigger.create': ['POST /v1/webhooks → createWebhook'],
	'trigger.checkExists (the state was lost: the secret is rotated)': [
		'GET /v1/webhooks → listWebhooks',
		'POST /v1/webhooks/{hook_id}/rotate-secret → rotateWebhookSecret',
	],
	'trigger.checkExists (the events changed: the subscription is updated)': [
		'GET /v1/webhooks → listWebhooks',
		'PATCH /v1/webhooks/{hook_id} → updateWebhook',
	],
	'trigger.delete': ['DELETE /v1/webhooks/{hook_id} → deleteWebhook'],
};

// The fields the code reads from the answers.
const READ: Record<string, string[]> = {
	listNumbers: ['data[].id', 'data[].phone_number_id', 'data[].display_phone_number', 'data[].alias', 'data[].verified_name'],
	listTemplates: ['data[].id', 'data[].name', 'data[].language', 'data[].status', 'data[].category'],
	createFlowToken: ['flow_token', 'expires_at'],
	listWebhooks: ['data[].id', 'data[].url', 'data[].name', 'data[].fields', 'data[].statuses', 'data[].instanceIds'],
	createWebhook: ['row.id', 'secret'],
	rotateWebhookSecret: ['secret'],
};

// The events of Instagram accounts and of comment actions: the nodes speak WhatsApp only, and the trigger answers an
// Instagram envelope without running the workflow.
const NOT_OFFERED = [
	'messaging_postbacks',
	'message_reactions',
	'messaging_seen',
	'messaging_referral',
	'message_edit',
	'messaging_optins',
	'comments',
	'live_comments',
	'mentions',
	'synergy_comment_actions',
];

const optionsOf = (properties: INodeProperties[], name: string, show?: string) =>
	(
		(properties.find((p) => p.name === name && (!show || JSON.stringify(p.displayOptions).includes(`"${show}"`)))
			?.options ?? []) as { value: string }[]
	).map((o) => o.value);

interface Outcome {
	name: string;
	error?: string;
	result?: unknown;
	state?: IDataObject;
	sent: FakeApiCall[];
	calls: (Checked & { asked: string })[];
}
const outcomes: Outcome[] = [];
if (doc) {
	for (const scenario of scenarios) {
		recorded.scopes.length = 0;
		const { calls, state, done } = scenario.start();
		let error: string | undefined;
		let result: unknown;
		try {
			result = await done();
		} catch (e) {
			error = (e as Error).message;
		}
		outcomes.push({
			name: scenario.name,
			error,
			result,
			state,
			sent: calls,
			calls: calls.map((call, i) => ({ ...checkCall(doc, call), asked: recorded.scopes[i] })),
		});
	}
}

if (!doc) {
	describe.skip('openapi.json ↔ the nodes: no document (set OPENAPI_FILE or OPENAPI_URL, or run inside the monorepo)', () => {
		it('every call of the nodes is an operation of the document', () => {});
	});
} else {
	const fieldsOf = (schema: string) =>
		((deref(doc, schema).properties as Record<string, Schema>).fields.items as Schema).enum as string[];

	describe('openapi.json ↔ the calls of the nodes', () => {
		it('there is a scenario for every operation of the action node and every method of the two nodes', () => {
			const names = new Set(scenarios.map((s) => s.name));
			const properties = action.description.properties;
			const operations = optionsOf(properties, 'resource').flatMap((resource) =>
				optionsOf(properties, 'operation', resource).map((operation) => `${resource}.${operation}`),
			);
			expect(operations.length).toBeGreaterThan(0);
			expect(operations.filter((o) => !names.has(o))).toEqual([]);
			const methods = [
				...Object.keys(action.methods.listSearch).map((m) => `action.listSearch.${m}`),
				...Object.keys(action.methods.loadOptions).map((m) => `action.loadOptions.${m}`),
				...Object.keys(trigger.methods.loadOptions).map((m) => `trigger.loadOptions.${m}`),
				...Object.keys(trigger.webhookMethods.default).map((m) => `trigger.${m}`),
			];
			expect(methods.filter((m) => ![...names].some((n) => n === m || n.startsWith(`${m} `)))).toEqual([]);
		});

		it('every scenario runs to the end', () => {
			expect(outcomes.filter((o) => o.error).map((o) => `${o.name}: ${o.error}`)).toEqual([]);
		});

		it('calls exactly these operations of the document', () => {
			expect(Object.fromEntries(outcomes.map((o) => [o.name, o.calls.map((c) => c.operation)]))).toEqual(EXPECTED);
		});

		it.each(outcomes)('$name: query, headers and body are the ones of the operation', ({ calls }) => {
			expect(calls.length).toBeGreaterThan(0);
			expect(calls.flatMap((c) => c.problems.map((p) => `${c.operation}: ${p}`))).toEqual([]);
		});

		it.each(outcomes)('$name: the scope the errors name is the scope of the operation', ({ calls }) => {
			for (const call of calls) {
				// an operation with no scope listed takes any key
				if (call.scopes && call.scopes.length > 0) expect(call.scopes, call.operation).toContain(call.asked);
				else expect(['messages', 'management'], call.operation).toContain(call.asked);
			}
		});

		it.each(Object.entries(READ))('%s answers the fields the nodes read', (operationId, fields) => {
			expect(fields.filter((field) => !answerHas(doc, operationId, field))).toEqual([]);
		});

		it('the formats of the path are the ones of the document', () => {
			const { GraphVersion, PhoneNumberId } = doc.components.parameters;
			expect(GRAPH_VERSION_PATTERN.source).toBe(GraphVersion.schema.pattern);
			expect(PHONE_NUMBER_ID_PATTERN.source).toBe(PhoneNumberId.schema.pattern);
			expect(DEFAULT_GRAPH_VERSION).toMatch(GRAPH_VERSION_PATTERN);
		});

		// The API passes the body of a message to Meta as it is, and Meta also takes CELL and MAIN for the phone of a
		// contact card; the document lists only HOME and WORK. When the document lists them, this gap closes.
		it('known gap: the phone types of a contact card that the document does not list', () => {
			const contacts = action.description.properties.find((p) => p.name === 'contacts');
			const offered = JSON.stringify(contacts).match(/"value":"([A-Z]+)"/g)?.map((m) => m.slice(9, -1)) ?? [];
			const card = deref(doc, '#/components/schemas/ContactCard').properties as Record<string, Schema>;
			const listed = ((card.phones.items as Schema).properties as Record<string, Schema>).type.enum as string[];
			expect(offered.filter((type) => !listed.includes(type)).sort()).toEqual(['CELL', 'MAIN']);
		});
	});

	// Every scenario above ran against the example answers of the document: what the nodes took from them.
	describe('openapi.json ↔ the answers the nodes read', () => {
		const outcome = (name: string) => outcomes.find((o) => o.name.startsWith(name)) as Outcome;
		const example = <T>(path: string, method: string) =>
			documentedAnswer(doc, { method, url: `${DEFAULT_BASE_URL}${path}` }).body as T;
		const [number] = example<{ data: Record<string, string>[] }>('/v1/numbers', 'GET').data;
		const [template] = example<{ data: Record<string, string>[] }>(`/v1/numbers/${NUMBER}/templates`, 'GET').data;

		it('the list of numbers of the action node answers the phone_number_id, the id of the routes', () => {
			const { results } = outcome('action.listSearch.searchNumbers').result as { results: { name: string; value: string }[] };
			expect(results.map((r) => r.value)).toEqual([number.phone_number_id]);
			expect(results[0].value).toMatch(PHONE_NUMBER_ID_PATTERN);
			expect(results[0].name).toBe(`${number.display_phone_number} · ${number.alias}`);
		});

		it('the list of numbers of the trigger answers the id a webhook takes in instanceIds', () => {
			const options = outcome('trigger.loadOptions.getInstances').result as { name: string; value: string }[];
			expect(options.map((o) => o.value)).toEqual([number.id]);
			const request = deref(doc, '#/components/schemas/CreateWebhookRequest').properties as Record<string, Schema>;
			for (const option of options) {
				expect(validate(doc, request.instanceIds, [option.value], 'instanceIds')).toEqual([]);
			}
		});

		it('the list of templates answers name::language, and Get Many simplifies to the five fields', () => {
			const options = outcome('action.loadOptions.getTemplates').result as { value: string }[];
			expect(options.map((o) => o.value)).toEqual([`${template.name}::${template.language}`]);
			const [[item]] = outcome('template.getAll').result as { json: IDataObject }[][];
			const { id, name, language, status, category } = template;
			expect(item.json).toEqual({ id, name, language, status, category });
		});

		it('Send Flow sends the token the API issued', () => {
			const token = example<{ flow_token: string; expires_at: string }>(`/v1/numbers/${NUMBER}/flows/1234567890/token`, 'POST');
			const { sent, result } = outcome('flow.sendFlow');
			expect(JSON.stringify(sent[1].body)).toContain(`"flow_token":"${token.flow_token}"`);
			const [[item]] = result as { json: IDataObject }[][];
			expect(item.json.flow_token_expires_at).toBe(token.expires_at);
		});

		it('the trigger keeps the id and the secret of the webhook it created, and the rotated secret', () => {
			const created = example<{ row: { id: string }; secret: string }>('/v1/webhooks', 'POST');
			expect(outcome('trigger.create').state).toEqual({ hooks: { [HOOK_URL]: { id: created.row.id, secret: created.secret } } });
			const rotated = example<{ secret: string }>(`/v1/webhooks/${HOOK}/rotate-secret`, 'POST');
			expect(outcome('trigger.checkExists (the state was lost').state).toEqual({
				hooks: { [HOOK_URL]: { id: HOOK, secret: rotated.secret } },
			});
		});
	});

	describe('openapi.json ↔ the credential', () => {
		const credential = new SynergyConnectApi();

		it('the default Base URL is a server of the document', () => {
			const servers = doc.servers.map((s) => s.url);
			expect(servers).toContain(DEFAULT_BASE_URL);
			expect(servers).toContain(credential.properties.find((p) => p.name === 'baseUrl')?.default);
		});

		it('the key goes where the document says: Authorization: Bearer, and nowhere else', () => {
			const [scheme] = Object.values(doc.components.securitySchemes);
			expect(scheme).toMatchObject({ type: 'http', scheme: 'bearer' });
			expect(credential.authenticate.properties).toEqual({
				headers: { Authorization: '=Bearer {{$credentials.apiKey}}' },
			});
			const placeholder = String(credential.properties.find((p) => p.name === 'apiKey')?.placeholder);
			expect(scheme.bearerFormat.startsWith(placeholder.split('_')[0] + '_')).toBe(true);
		});

		it('the test of the credential is an operation that takes any key and sends nothing', () => {
			const { method, url, body } = credential.test.request as { method: string; url: string; body?: unknown };
			const checked = checkCall(doc, { method, url: `${DEFAULT_BASE_URL}${url}`, body });
			expect(checked).toEqual({ operation: 'GET /v1/me → getMe', scopes: [], problems: [] });
		});
	});

	describe('openapi.json ↔ the events of the trigger', () => {
		const properties = trigger.description.properties;
		const offered = [...optionsOf(properties, 'events'), ...optionsOf(properties, 'advancedEvents')];
		const subscribable = fieldsOf('#/components/schemas/CreateWebhookRequest');

		it('every event of the node is a field a webhook can subscribe to, and has its page in the catalog', () => {
			expect(new Set(offered).size).toBe(offered.length);
			expect(offered.filter((e) => !subscribable.includes(e))).toEqual([]);
			expect(offered.filter((e) => !fieldsOf('#/components/schemas/UpdateWebhookRequest').includes(e))).toEqual([]);
			expect(offered.filter((e) => !doc.webhooks[e])).toEqual([]);
		});

		it('the only fields the node leaves out are the ones of Instagram', () => {
			expect(subscribable.filter((e) => !offered.includes(e)).sort()).toEqual([...NOT_OFFERED].sort());
		});

		it('every event has its output label', () => {
			expect(Object.keys(EVENT_LABELS).sort()).toEqual([...offered].sort());
		});

		it('the status filter has the statuses of the document', () => {
			const request = deref(doc, '#/components/schemas/CreateWebhookRequest').properties as Record<string, Schema>;
			const statuses = (request.statuses.anyOf as Schema[]).flatMap((s) => ((s.items as Schema)?.enum as string[]) ?? []);
			expect(optionsOf(properties, 'statusFilter').sort()).toEqual([...statuses].sort());
		});

		it('the ping is in the catalog and is never subscribed', () => {
			expect(doc.webhooks.synergy_ping).toBeDefined();
			expect(subscribable).not.toContain('synergy_ping');
		});

		const examples = offered.flatMap((event) =>
			Object.entries(doc.webhooks[event]?.post.requestBody?.content['application/json'].examples ?? {}).map(
				([name, example]) => ({ event, name, body: example.value as IDataObject }),
			),
		);

		it('the catalog has examples to route', () => {
			expect(examples.length).toBeGreaterThan(0);
		});

		it.each(examples)('the example "$name" of $event becomes items of that event', ({ event, body }) => {
			const result = routeEnvelope(
				body,
				{ events: [event], mode: 'single', statuses: [] },
				{ deliveryId: 'ev-1', timestamped: true, instanceId: null },
			);
			if (body.object === 'instagram') return expect(result).toEqual({ kind: 'instagram' });
			const items = (result as { workflowData?: { json: IDataObject }[][] }).workflowData?.[0] ?? [];
			expect(items.length).toBeGreaterThan(0);
			for (const item of items) expect(item.json._eventType).toBe(event);
		});
	});

	describe('openapi.json ↔ the signature the trigger verifies', () => {
		const delivery = doc['x-webhook-delivery'];
		const { timestamped } = delivery.signature;
		const vector = timestamped.example;
		const headers = { 'x-synergy-signature': vector.header, 'x-synergy-delivery-id': vector.deliveryId };

		it('the headers and the tolerance are the ones of the document', () => {
			const names = delivery.headers.map((h) => h.name.toLowerCase());
			expect(timestamped.header.toLowerCase()).toBe('x-synergy-signature');
			expect(delivery.idempotency.header.toLowerCase()).toBe('x-synergy-delivery-id');
			for (const name of ['x-synergy-signature', 'x-synergy-delivery-id', 'x-synergy-instance-id']) {
				expect(names).toContain(name);
			}
			expect(timestamped.toleranceSeconds).toBe(TOLERANCE_SECONDS);
		});

		it('the vector of the document verifies, inside the tolerance only', () => {
			expect(verifySignature(vector.body, headers, vector.secret, { nowSeconds: vector.t })).toEqual({
				ok: true,
				timestamped: true,
				deliveryId: vector.deliveryId,
			});
			const late = { nowSeconds: vector.t + timestamped.toleranceSeconds + 1 };
			expect(verifySignature(vector.body, headers, vector.secret, late).ok).toBe(false);
			expect(verifySignature(`${vector.body} `, headers, vector.secret, { nowSeconds: vector.t }).ok).toBe(false);
		});

		it('the vectors the other tests sign with are the ones of the document', () => {
			const { signingKey, ...stamped } = TIMESTAMPED_SIGNATURE_EXAMPLE;
			expect({ ...stamped, secret: signingKey }).toEqual(vector);
			const { signingKey: hubKey, ...hub } = SIGNATURE_EXAMPLE;
			expect({ ...hub, secret: hubKey }).toEqual(delivery.signature.example);
		});

		it('the body of the vector is the ping, which never runs the workflow', () => {
			const result = routeEnvelope(
				JSON.parse(vector.body),
				{ events: ['messages'], mode: 'single', statuses: [] },
				{ deliveryId: vector.deliveryId, timestamped: true, instanceId: null },
			);
			expect(result).toEqual({ kind: 'ping' });
		});
	});
}
