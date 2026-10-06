import { createHmac } from 'crypto';
import { vi } from 'vitest';
import type { IDataObject, IExecuteFunctions, IHookFunctions, IWebhookFunctions } from 'n8n-workflow';

// The test vectors of the signature: copied from `src/api/public/webhook-events.ts` (SIGNATURE_EXAMPLE and
// TIMESTAMPED_SIGNATURE_EXAMPLE), the contract of the API.
export const SIGNATURE_EXAMPLE = {
	signingKey: '0123456789abcdef'.repeat(2), // the public test vector, not a real secret
	body: '{"object":"whatsapp_business_account","entry":[{"id":"0","time":1767225600,"changes":[{"field":"synergy_ping","value":{"messaging_product":"whatsapp","ping":true,"timestamp":"1767225600"}}]}]}',
	header: 'sha256=b34c62852bf9eb4132dbac56d4b909a1e62d3df61b21807329b6c1f4d59ec77e',
} as const;

export const TIMESTAMPED_SIGNATURE_EXAMPLE = {
	signingKey: SIGNATURE_EXAMPLE.signingKey,
	body: SIGNATURE_EXAMPLE.body,
	deliveryId: 'ping-3f9a1c0b-7d2e-4a6f-8b1c-2d3e4f5a6b7c',
	t: 1767225600,
	header: 't=1767225600,v1=9baa189aceecd03d75cb0a92954f222a09db72a2a786d079af44beee79609372',
} as const;

export const SECRET = SIGNATURE_EXAMPLE.signingKey;
export const HOOK_URL = 'https://n8n.example.com/webhook/abc/webhook';
export const TEST_HOOK_URL = 'https://n8n.example.com/webhook-test/abc/webhook';

export const hubSignature = (body: string, secret = SECRET) =>
	`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

export const timestampedSignature = (body: string, deliveryId: string, t: number, secret = SECRET) =>
	`t=${t},v1=${createHmac('sha256', secret).update(`${t}.${deliveryId}.${body}`).digest('hex')}`;

export const envelope = (changes: IDataObject[], extra: IDataObject = {}) =>
	JSON.stringify({
		object: 'whatsapp_business_account',
		entry: [{ id: '1029384756', time: 1767225600, changes }],
		...extra,
	});

export const messageChange = (message: IDataObject): IDataObject => ({
	field: 'messages',
	value: {
		messaging_product: 'whatsapp',
		metadata: { display_phone_number: '5511999990000', phone_number_id: '102290129340398' },
		contacts: [{ wa_id: '5511988887777', profile: { name: 'Maria' } }],
		messages: [message],
	},
});

export const statusChange = (status: string): IDataObject => ({
	field: 'messages',
	value: {
		messaging_product: 'whatsapp',
		metadata: { phone_number_id: '102290129340398' },
		statuses: [{ id: 'wamid.S', status, recipient_id: '5511988887777' }],
	},
});

export const textMessage = { id: 'wamid.T', from: '5511988887777', type: 'text', text: { body: 'oi' } };

export interface FakeResponse {
	status: ReturnType<typeof vi.fn>;
	send: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
}

export function webhookContext(options: {
	rawBody?: Buffer | string | undefined;
	headers?: Record<string, string | string[]>;
	staticData?: IDataObject;
	params?: IDataObject;
	url?: string;
}) {
	const res: FakeResponse = {
		status: vi.fn(),
		send: vi.fn(),
		end: vi.fn(),
	};
	res.status.mockReturnValue(res);
	res.send.mockReturnValue(res);
	res.end.mockReturnValue(res);
	const staticData = options.staticData ?? {};
	const params: IDataObject = {
		events: ['messages'],
		advancedEvents: [],
		statusFilter: [],
		outputMode: 'single',
		...options.params,
	};
	const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
	const ctx = {
		getRequestObject: () => ({
			headers: options.headers ?? {},
			rawBody: options.rawBody,
		}),
		getResponseObject: () => res,
		getNodeWebhookUrl: () => options.url ?? HOOK_URL,
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (name: string, fallback?: unknown) => params[name] ?? fallback,
		logger,
	} as unknown as IWebhookFunctions;
	return { ctx, res, logger, staticData };
}

export const registered = (url = HOOK_URL, secret = SECRET): IDataObject => ({
	hooks: { [url]: { id: 'hook-1', secret } },
});

export interface FakeApiCall {
	method: string;
	url: string;
	qs?: IDataObject;
	body?: unknown;
	headers?: IDataObject;
}

type Handler = (call: FakeApiCall) => { statusCode?: number; headers?: Record<string, string>; body?: unknown };

// The HTTP layer of n8n: `httpRequestWithAuthentication` answers by `handler`.
export function fakeHttp(handler: Handler) {
	const calls: FakeApiCall[] = [];
	const request = vi.fn(async (_credential: string, options: IDataObject) => {
		const call = {
			method: String(options.method),
			url: String(options.url),
			qs: options.qs as IDataObject | undefined,
			body: options.body,
			headers: options.headers as IDataObject | undefined,
		};
		calls.push(call);
		const answer = handler(call);
		return { statusCode: answer.statusCode ?? 200, headers: answer.headers ?? {}, body: answer.body ?? {} };
	});
	return { calls, request };
}

export const CREDENTIALS = {
	apiKey: 'syn_secretkey',
	baseUrl: 'https://api.synergyconnect.com.br',
	phoneNumberId: '102290129340398',
};

const NODE = { name: 'Synergy Connect', type: '@synergyconnectapp/n8n-nodes-synergy-connect.synergyConnect', typeVersion: 1 };

export function hookContext(options: {
	handler: Handler;
	staticData?: IDataObject;
	url?: string;
	mode?: 'trigger' | 'manual';
	params?: IDataObject;
	credentials?: IDataObject;
}) {
	const http = fakeHttp(options.handler);
	const staticData = options.staticData ?? {};
	const params: IDataObject = {
		events: ['messages'],
		advancedEvents: [],
		statusFilter: [],
		phoneNumbers: [],
		...options.params,
	};
	const ctx = {
		getNode: () => NODE,
		getCredentials: async () => options.credentials ?? CREDENTIALS,
		getNodeWebhookUrl: () => options.url ?? HOOK_URL,
		getWorkflowStaticData: () => staticData,
		getNodeParameter: (name: string, fallback?: unknown) => params[name] ?? fallback,
		getWorkflow: () => ({ id: 'wf1', name: 'Atendimento', active: true }),
		getMode: () => options.mode ?? 'trigger',
		helpers: { httpRequestWithAuthentication: http.request },
		logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
	} as unknown as IHookFunctions;
	return { ctx, calls: http.calls, request: http.request, staticData };
}

export function executeContext(options: {
	handler: Handler;
	params: IDataObject;
	credentials?: IDataObject;
	items?: number;
	binary?: IDataObject;
}) {
	const http = fakeHttp(options.handler);
	const prepareBinaryData = vi.fn(async (buffer: Buffer, fileName: string, mimeType: string) => ({
		data: buffer.toString('base64'),
		fileName,
		mimeType,
	}));
	const ctx = {
		getNode: () => NODE,
		getCredentials: async () => options.credentials ?? CREDENTIALS,
		getInputData: () => Array.from({ length: options.items ?? 1 }, () => ({ json: {} })),
		getExecutionId: () => 'exec1',
		continueOnFail: () => false,
		getNodeParameter: (name: string, _i: number, fallback?: unknown, extra?: { extractValue?: boolean }) => {
			const value = options.params[name];
			if (value === undefined) return fallback;
			if (extra?.extractValue && value && typeof value === 'object' && 'value' in (value as object)) {
				return (value as IDataObject).value;
			}
			return value;
		},
		helpers: {
			httpRequestWithAuthentication: http.request,
			constructExecutionMetaData: (items: unknown) => items,
			returnJsonArray: (value: IDataObject | IDataObject[]) =>
				(Array.isArray(value) ? value : [value]).map((json) => ({ json })),
			prepareBinaryData,
			assertBinaryData: () => ({ mimeType: 'image/png', fileName: 'logo.png' }),
			getBinaryDataBuffer: async () => Buffer.from('FILE'),
		},
	} as unknown as IExecuteFunctions;
	return { ctx, calls: http.calls, request: http.request, prepareBinaryData };
}
