import type {
	ICredentialDataDecryptedObject,
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const DEFAULT_BASE_URL = 'https://api.synergyconnect.com.br';
export const DEFAULT_GRAPH_VERSION = 'v25.0';

// The patterns of the path parameters, as the OpenAPI of the API declares them (GraphVersion, PhoneNumberId).
export const GRAPH_VERSION_PATTERN = /^v\d{1,3}\.\d{1,2}$/;
export const PHONE_NUMBER_ID_PATTERN = /^\d{5,20}$/;

export const HTTPS_ONLY_MESSAGE = 'The Synergy Connect API URL must use https.';
export const BASE_URL_PATH_MESSAGE =
	'The Base URL of the credential must be only the address of the Synergy Connect API, with no path: https://api.synergyconnect.com.br. The node adds the route itself.';

type Ctx = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export type Scope = 'messages' | 'management';

export interface ApiResponse {
	statusCode: number;
	headers: Record<string, string>;
	body: unknown;
}

// S-46 (K-08): the checks run BEFORE any request, so the key only ever goes to an https origin of the API. The API
// has one host per environment and its routes start at the root (`/v1/…`, `/{graph version}/…`), so a Base URL with
// a path, a query or a fragment is not an address of this API.
export function resolveBaseUrl(node: INode, credentials: ICredentialDataDecryptedObject): string {
	const raw = typeof credentials.baseUrl === 'string' ? credentials.baseUrl.trim() : '';
	const baseUrl = raw || DEFAULT_BASE_URL;
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new NodeOperationError(node, 'The Synergy Connect API URL is not a valid URL.');
	}
	if (url.protocol !== 'https:') {
		throw new NodeOperationError(node, HTTPS_ONLY_MESSAGE);
	}
	if (url.username || url.password) {
		throw new NodeOperationError(node, 'The Synergy Connect API URL must not contain a user name or password.');
	}
	if (url.pathname.replace(/\/+$/, '') !== '' || url.search || url.hash) {
		throw new NodeOperationError(node, BASE_URL_PATH_MESSAGE);
	}
	return url.origin;
}

function errorText(body: unknown): { message?: string; code?: number } {
	if (typeof body === 'string') return { message: body.slice(0, 300) };
	if (!body || typeof body !== 'object') return {};
	const error = (body as IDataObject).error;
	if (typeof error === 'string') return { message: error };
	if (error && typeof error === 'object') {
		const e = error as IDataObject;
		return {
			message: typeof e.message === 'string' ? e.message : undefined,
			code: typeof e.code === 'number' ? e.code : undefined,
		};
	}
	return {};
}

const PLAN_CODES = new Set([1390004, 1390005, 1390007, 1390011]);

export interface ErrorHints {
	// shown instead of the generic text when the plan refuses (403 with a plan code)
	planMessage?: string;
}

export function describeError(
	status: number,
	body: unknown,
	headers: Record<string, string>,
	scope: Scope,
	hints: ErrorHints = {},
): { message: string; description: string } {
	const { message: apiMessage, code } = errorText(body);
	const detail = apiMessage ? ` Synergy Connect said: ${apiMessage}` : '';
	const scopeText =
		scope === 'management'
			? 'the "management" scope (webhooks and writing templates)'
			: 'the "messages" scope (sending, media, templates, handoff and flows)';

	if (status === 401) {
		return {
			message: 'Synergy Connect rejected the API key (401)',
			description: `The key is invalid, revoked, or does not have ${scopeText}. After a 403 the API also answers 401 for the next 60 seconds. Create a key in the Synergy Connect app (Configurações → API e webhooks) with the messages and management scopes.${detail}`,
		};
	}
	if (status === 403) {
		if (hints.planMessage && code !== undefined && PLAN_CODES.has(code)) {
			return { message: hints.planMessage, description: detail.trim() };
		}
		if (code !== undefined && PLAN_CODES.has(code)) {
			return {
				message: 'The plan or the account does not allow this operation (403)',
				description: `Check the plan (the API, the inbox and WhatsApp Flows are plan features) and the account status in the Synergy Connect app (Configurações → Plano e uso).${detail}`,
			};
		}
		return {
			message: 'Synergy Connect refused the operation (403)',
			description: `The key probably lacks ${scopeText}, or it cannot reach this number. After a 403 the API answers 401 for the next 60 seconds.${detail}`,
		};
	}
	if (status === 429) {
		const wait = headers['retry-after'];
		return {
			message: 'Synergy Connect rate limit reached (429)',
			description: `${wait ? `Try again in ${wait} seconds (Retry-After). ` : ''}Slow the workflow down or add a Wait node.${detail}`,
		};
	}
	return {
		message: apiMessage ?? `Synergy Connect answered HTTP ${status}`,
		description: apiMessage ? `HTTP ${status}` : '',
	};
}

export interface RequestOptions {
	method: IHttpRequestMethods;
	path: string;
	scope: Scope;
	qs?: IDataObject;
	body?: IDataObject | FormData;
	headers?: Record<string, string>;
	// the file of a media download
	binary?: boolean;
	itemIndex?: number;
	hints?: ErrorHints;
}

// Every call goes to the credential's own origin: the key travels in the headers n8n adds, redirects are never
// followed and any status >= 300 is an error, so the key can't be handed to another host (S-46).
export async function apiRequest(ctx: Ctx, options: RequestOptions): Promise<ApiResponse> {
	const node = ctx.getNode();
	const credentials = await ctx.getCredentials('synergyConnectApi');
	const baseUrl = resolveBaseUrl(node, credentials);

	const request: IHttpRequestOptions = {
		method: options.method,
		url: `${baseUrl}${options.path}`,
		qs: options.qs,
		headers: options.headers,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		disableFollowRedirect: true,
	};
	if (options.body !== undefined) request.body = options.body;
	if (options.binary) request.encoding = 'arraybuffer';
	else if (!(options.body instanceof FormData)) request.json = true;

	const response = (await ctx.helpers.httpRequestWithAuthentication.call(
		ctx,
		'synergyConnectApi',
		request,
	)) as { statusCode: number; headers?: Record<string, string>; body?: unknown };

	const headers = response.headers ?? {};
	if (response.statusCode >= 300) {
		let body = response.body;
		if (body instanceof ArrayBuffer || Buffer.isBuffer(body)) {
			try {
				body = JSON.parse(Buffer.from(body as ArrayBuffer).toString('utf8')) as unknown;
			} catch {
				body = undefined;
			}
		}
		const { message, description } =
			response.statusCode < 400
				? {
						message: `Synergy Connect answered with a redirect (${response.statusCode}); the request was not followed`,
						description: 'Check the Base URL of the credential.',
					}
				: describeError(response.statusCode, body, headers, options.scope, options.hints);
		const apiError = new NodeApiError(
			node,
			{ message, httpCode: String(response.statusCode) } as JsonObject,
			{
				message,
				description,
				httpCode: String(response.statusCode),
				itemIndex: options.itemIndex,
			},
		);
		// the seconds of Retry-After, for the callers that wait it out
		const retryAfter = Number(headers['retry-after']);
		throw Object.assign(apiError, Number.isFinite(retryAfter) ? { retryAfter } : {});
	}
	return { statusCode: response.statusCode, headers, body: response.body };
}

// The phone number of an operation: the resource locator, or the credential's default number.
export async function resolvePhoneNumberId(ctx: IExecuteFunctions | ILoadOptionsFunctions, itemIndex?: number) {
	const picked =
		itemIndex === undefined
			? ((ctx as ILoadOptionsFunctions).getCurrentNodeParameter('phoneNumberId', {
					extractValue: true,
				}) as string | undefined)
			: ((ctx as IExecuteFunctions).getNodeParameter('phoneNumberId', itemIndex, '', {
					extractValue: true,
				}) as string);
	const credentials = await ctx.getCredentials('synergyConnectApi');
	const fallback = typeof credentials.phoneNumberId === 'string' ? credentials.phoneNumberId : '';
	const value = String(picked ?? '').trim() || fallback.trim();
	if (!value) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Choose a Phone Number in the node, or set a default Phone Number ID in the credential.',
			{ itemIndex },
		);
	}
	if (!PHONE_NUMBER_ID_PATTERN.test(value)) {
		throw new NodeOperationError(ctx.getNode(), 'The Phone Number ID must be 5 to 20 digits.', { itemIndex });
	}
	return value;
}

export function pathPart(value: string): string {
	return encodeURIComponent(value.trim());
}
