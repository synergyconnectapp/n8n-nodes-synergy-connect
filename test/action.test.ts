import { describe, expect, it } from 'vitest';
import { SynergyConnectV1 } from '../nodes/SynergyConnect/v1/SynergyConnectV1.node';
import { buildMessageBody } from '../nodes/SynergyConnect/v1/actions/message';
import { buildTemplateComponents } from '../nodes/SynergyConnect/v1/actions/template';
import { resolveBaseUrl } from '../nodes/SynergyConnect/v1/transport';
import { CREDENTIALS, executeContext } from './helpers';

const node = new SynergyConnectV1({
	displayName: 'Synergy Connect',
	name: 'synergyConnect',
	icon: 'file:synergyConnect.svg',
	group: ['transform'],
	description: '',
});

const NUMBER = { mode: 'id', value: '102290129340398' };
const BASE = 'https://api.synergyconnect.com.br';

const fail = (message: string) => new Error(message);
const getter = (params: Record<string, unknown>) => (name: string, fallback?: unknown) =>
	params[name] === undefined ? fallback : params[name];

describe('the node refuses a credential before any call (S-46, E1-4)', () => {
	const cases: [string, RegExp][] = [
		['https://synergyconnect.com.br/api/v1', /with no path/],
		['https://api.synergyconnect.com.br/v1', /with no path/],
		['https://api.synergyconnect.com.br/?key=1', /with no path/],
		['https://api.synergyconnect.com.br/#v1', /with no path/],
		['http://api.synergyconnect.com.br', /must use https/],
		['https://user:pass@api.synergyconnect.com.br', /user name or password/],
		['ftp://api.synergyconnect.com.br', /must use https/],
		['api.synergyconnect.com.br', /not a valid URL/],
	];
	for (const [baseUrl, message] of cases) {
		it(baseUrl, async () => {
			const { ctx, calls } = executeContext({
				handler: () => ({}),
				params: { resource: 'message', operation: 'sendText', phoneNumberId: NUMBER, to: '5511', text: 'oi' },
				credentials: { ...CREDENTIALS, baseUrl },
			});
			await expect(node.execute.call(ctx)).rejects.toThrow(message);
			expect(calls).toHaveLength(0);
		});
	}

	it('resolveBaseUrl answers the origin: the default, a trailing slash, another host of the API', () => {
		const resolve = (baseUrl: string) => resolveBaseUrl({ name: 'n' } as never, { baseUrl });
		expect(resolve('')).toBe(BASE);
		expect(resolve(` ${BASE}/ `)).toBe(BASE);
		expect(resolve('https://api-staging.synergyconnect.com.br')).toBe('https://api-staging.synergyconnect.com.br');
	});

	it('an empty Base URL falls back to the default host', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({ body: { messages: [{ id: 'wamid.1' }] } }),
			params: { resource: 'message', operation: 'sendText', phoneNumberId: NUMBER, to: '5511', text: 'oi' },
			credentials: { apiKey: 'syn_x', baseUrl: '' },
		});
		await node.execute.call(ctx);
		expect(calls[0].url.startsWith(BASE)).toBe(true);
	});

	it('3xx is an error and redirects are not followed', async () => {
		const { ctx, request } = executeContext({
			handler: () => ({ statusCode: 302, headers: { location: 'https://evil.example/' } }),
			params: { resource: 'message', operation: 'sendText', phoneNumberId: NUMBER, to: '5511', text: 'oi' },
		});
		await expect(node.execute.call(ctx)).rejects.toThrow(/redirect/);
		expect(request.mock.calls[0][1]).toMatchObject({ disableFollowRedirect: true });
	});
});

describe('Message', () => {
	it('Send Text: route, body and headers (Idempotency-Key by default, Replies Go To)', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({ body: { messages: [{ id: 'wamid.1' }] } }),
			params: {
				resource: 'message',
				operation: 'sendText',
				phoneNumberId: NUMBER,
				to: '5511988887777',
				text: 'Olá',
				messageOptions: { repliesGoTo: 'queue', replyToMessageId: 'wamid.Q' },
			},
		});
		const out = await node.execute.call(ctx);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe(`${BASE}/v25.0/102290129340398/messages`);
		expect(calls[0].body).toEqual({
			messaging_product: 'whatsapp',
			to: '5511988887777',
			context: { message_id: 'wamid.Q' },
			type: 'text',
			text: { body: 'Olá' },
		});
		expect(calls[0].headers).toEqual({ 'Idempotency-Key': 'exec1-0', 'X-Synergy-Replies': 'queue' });
		expect(out[0][0].json).toEqual({ messages: [{ id: 'wamid.1' }] });
	});

	it('uses the default number of the credential when the node chooses none', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({ body: {} }),
			params: { resource: 'message', operation: 'sendText', phoneNumberId: { mode: 'list', value: '' }, to: '5511', text: 'a' },
		});
		await node.execute.call(ctx);
		expect(calls[0].url).toContain('/102290129340398/messages');
	});

	it('a Graph API version that is not vN.N is refused', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({}),
			params: {
				resource: 'message',
				operation: 'sendText',
				phoneNumberId: NUMBER,
				to: '5511',
				text: 'a',
				messageOptions: { graphApiVersion: '../v1/me?' },
			},
		});
		await expect(node.execute.call(ctx)).rejects.toThrow(/Graph API Version/);
		expect(calls).toHaveLength(0);
	});

	it('explains 401, 403 and 429', async () => {
		const run = async (statusCode: number, headers: Record<string, string> = {}) => {
			const { ctx } = executeContext({
				handler: () => ({ statusCode, headers, body: { error: { message: 'x', code: 190 } } }),
				params: { resource: 'message', operation: 'sendText', phoneNumberId: NUMBER, to: '5511', text: 'a' },
			});
			return await node.execute.call(ctx);
		};
		await expect(run(401)).rejects.toThrow(/rejected the API key/);
		await expect(run(403)).rejects.toThrow(/refused the operation/);
		await expect(run(429, { 'retry-after': '12' })).rejects.toThrow(/rate limit/i);
	});

	it('the key never appears in an error', async () => {
		const { ctx } = executeContext({
			handler: () => ({ statusCode: 401, body: { error: 'Invalid or revoked key' } }),
			params: { resource: 'message', operation: 'sendText', phoneNumberId: NUMBER, to: '5511', text: 'a' },
		});
		const error = (await node.execute.call(ctx).catch((e: unknown) => e)) as Error;
		expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('syn_secretkey');
	});

	it('Mark as Read has no recipient', () => {
		expect(buildMessageBody('markAsRead', getter({ readMessageId: 'wamid.R' }), fail)).toEqual({
			messaging_product: 'whatsapp',
			status: 'read',
			message_id: 'wamid.R',
		});
	});

	it('Send Raw: any body, messaging_product added', () => {
		const body = buildMessageBody(
			'sendRaw',
			getter({ rawBody: '{"to":"5511","type":"text","text":{"body":"x"}}' }),
			fail,
		);
		expect(body).toEqual({ messaging_product: 'whatsapp', to: '5511', type: 'text', text: { body: 'x' } });
		expect(() => buildMessageBody('sendRaw', getter({ rawBody: '[1]' }), fail)).toThrow(/JSON object/);
		expect(() => buildMessageBody('sendRaw', getter({ rawBody: '{' }), fail)).toThrow(/not valid JSON/);
	});

	it('Send Audio with Voice, Send Sticker, Send Document', () => {
		expect(
			buildMessageBody('sendAudio', getter({ to: '5511', mediaSource: 'id', mediaId: '77', voice: true }), fail),
		).toMatchObject({ type: 'audio', audio: { id: '77', voice: true } });
		expect(
			buildMessageBody('sendSticker', getter({ to: '5511', mediaSource: 'link', mediaLink: 'https://x/s.webp' }), fail),
		).toMatchObject({ type: 'sticker', sticker: { link: 'https://x/s.webp' } });
		expect(
			buildMessageBody(
				'sendDocument',
				getter({ to: '5511', mediaLink: 'https://x/a.pdf', caption: 'c', filename: 'a.pdf' }),
				fail,
			),
		).toMatchObject({ type: 'document', document: { link: 'https://x/a.pdf', caption: 'c', filename: 'a.pdf' } });
	});

	it('Send Template: structured variables, language from the picked template, JSON overrides', () => {
		const structured = buildMessageBody(
			'sendTemplate',
			getter({
				to: '5511',
				template: 'order_update::pt_BR',
				headerVariable: 'Maria',
				bodyVariables: { values: [{ value: 'A1' }, { value: '12' }] },
			}),
			fail,
		);
		expect(structured.template).toEqual({
			name: 'order_update',
			language: { code: 'pt_BR' },
			components: [
				{ type: 'header', parameters: [{ type: 'text', text: 'Maria' }] },
				{ type: 'body', parameters: [{ type: 'text', text: 'A1' }, { type: 'text', text: '12' }] },
			],
		});
		const json = buildMessageBody(
			'sendTemplate',
			getter({
				to: '5511',
				template: 'order_update',
				templateLanguage: 'en_US',
				templateComponents: '[{"type":"button","sub_type":"url","index":"0","parameters":[]}]',
				bodyVariables: { values: [{ value: 'ignored' }] },
			}),
			fail,
		);
		expect(json.template).toMatchObject({
			language: { code: 'en_US' },
			components: [{ type: 'button' }],
		});
		expect(() => buildMessageBody('sendTemplate', getter({ to: '5511', template: 'order_update' }), fail)).toThrow(
			/Language Code/,
		);
	});

	it('Send Buttons and Send List', () => {
		expect(
			buildMessageBody(
				'sendButtons',
				getter({
					to: '5511',
					buttonsBody: 'Ok?',
					buttons: { buttonValues: [{ buttonId: 'y', buttonTitle: 'Yes' }] },
				}),
				fail,
			).interactive,
		).toEqual({
			type: 'button',
			body: { text: 'Ok?' },
			action: { buttons: [{ type: 'reply', reply: { id: 'y', title: 'Yes' } }] },
		});
		expect(
			buildMessageBody(
				'sendList',
				getter({
					to: '5511',
					listBody: 'Pick',
					listButton: 'Choose',
					listSections: { sectionValues: [{ sectionTitle: 'S', rows: '[{"id":"1","title":"One"}]' }] },
				}),
				fail,
			).interactive,
		).toMatchObject({ type: 'list', action: { button: 'Choose', sections: [{ title: 'S', rows: [{ id: '1' }] }] } });
	});
});

describe('Media', () => {
	it('Upload is multipart to /{v}/{pnid}/media and returns the id', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({ body: { id: '7788' } }),
			params: { resource: 'media', operation: 'upload', phoneNumberId: NUMBER, binaryPropertyName: 'data', mimeType: '' },
		});
		const out = await node.execute.call(ctx);
		expect(calls[0].url).toBe(`${BASE}/v25.0/102290129340398/media`);
		const form = calls[0].body as FormData;
		expect(form).toBeInstanceOf(FormData);
		expect(form.get('messaging_product')).toBe('whatsapp');
		expect(form.get('type')).toBe('image/png');
		expect((form.get('file') as File).type).toBe('image/png');
		expect(out[0][0].json).toEqual({ id: '7788' });
	});

	it('Get passes phone_number_id in the query; Delete returns { deleted: true }', async () => {
		const get = executeContext({
			handler: () => ({ body: { id: '9', mime_type: 'image/jpeg' } }),
			params: { resource: 'media', operation: 'get', phoneNumberId: NUMBER, mediaId: '9' },
		});
		await node.execute.call(get.ctx);
		expect(get.calls[0]).toMatchObject({
			method: 'GET',
			url: `${BASE}/v25.0/9`,
			qs: { phone_number_id: '102290129340398' },
		});

		const del = executeContext({
			handler: () => ({ body: { success: true } }),
			params: { resource: 'media', operation: 'delete', phoneNumberId: NUMBER, mediaId: '9' },
		});
		const out = await node.execute.call(del.ctx);
		expect(del.calls[0].method).toBe('DELETE');
		expect(out[0][0].json).toEqual({ deleted: true });
	});

	it('Download returns the file in `binary`, not in json', async () => {
		const { ctx, calls, prepareBinaryData } = executeContext({
			handler: () => ({ headers: { 'content-type': 'image/jpeg; charset=x' }, body: Buffer.from('JPEGDATA') }),
			params: { resource: 'media', operation: 'download', phoneNumberId: NUMBER, mediaId: '9', outputBinaryField: 'file' },
		});
		const out = await node.execute.call(ctx);
		expect(calls[0].url).toBe(`${BASE}/v25.0/9/download`);
		expect(calls[0].qs).toEqual({ phone_number_id: '102290129340398' });
		expect(prepareBinaryData).toHaveBeenCalledWith(Buffer.from('JPEGDATA'), '9', 'image/jpeg');
		expect(out[0][0].binary?.file).toMatchObject({ mimeType: 'image/jpeg' });
		expect(out[0][0].json).toEqual({ id: '9', mime_type: 'image/jpeg' });
	});
});

describe('Template (on the number routes)', () => {
	const params = (operation: string, extra: Record<string, unknown> = {}) => ({
		resource: 'template',
		operation,
		phoneNumberId: NUMBER,
		...extra,
	});
	const base = `${BASE}/v1/numbers/102290129340398/templates`;

	it('Get Many: query, Return All = 100 and Simplify', async () => {
		const full = { id: '1', name: 'a', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY', components: [{}] };
		const { ctx, calls } = executeContext({
			handler: () => ({ body: { data: [full] } }),
			params: params('getAll', {
				returnAll: true,
				simplify: true,
				filters: { status: 'PENDING', name: 'ord', language: 'pt_BR' },
			}),
		});
		const out = await node.execute.call(ctx);
		expect(calls[0]).toMatchObject({
			method: 'GET',
			url: base,
			qs: { limit: 100, status: 'PENDING', name: 'ord', language: 'pt_BR' },
		});
		expect(out[0][0].json).toEqual({ id: '1', name: 'a', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY' });

		const raw = executeContext({
			handler: () => ({ body: { data: [full] } }),
			params: params('getAll', { returnAll: false, limit: 5, simplify: false }),
		});
		const outRaw = await node.execute.call(raw.ctx);
		expect(raw.calls[0].qs).toEqual({ limit: 5 });
		expect(outRaw[0][0].json).toHaveProperty('components');
	});

	it('Get, Create, Update, Delete and Upload Example Media', async () => {
		const get = executeContext({ handler: () => ({ body: { id: '9' } }), params: params('get', { templateId: '9' }) });
		await node.execute.call(get.ctx);
		expect(get.calls[0]).toMatchObject({ method: 'GET', url: `${base}/9` });

		const create = executeContext({
			handler: () => ({ body: { id: '10', status: 'PENDING', category: 'UTILITY' } }),
			params: params('create', {
				tplName: 'order_update',
				tplLanguage: 'pt_BR',
				tplCategory: 'UTILITY',
				tplBody: 'Hello {{1}}',
				tplBodyExamples: 'Maria',
			}),
		});
		await node.execute.call(create.ctx);
		expect(create.calls[0]).toMatchObject({ method: 'POST', url: base });
		expect(create.calls[0].body).toEqual({
			name: 'order_update',
			language: 'pt_BR',
			category: 'UTILITY',
			components: [{ type: 'BODY', text: 'Hello {{1}}', example: { body_text: [['Maria']] } }],
		});

		const update = executeContext({
			handler: () => ({ body: { success: true } }),
			params: params('update', { templateId: '9', tplComponents: '[{"type":"BODY","text":"New"}]', tplUpdateCategory: '' }),
		});
		await node.execute.call(update.ctx);
		expect(update.calls[0]).toMatchObject({ method: 'POST', url: `${base}/9`, body: { components: [{ type: 'BODY', text: 'New' }] } });

		const del = executeContext({ handler: () => ({ body: { success: true } }), params: params('delete', { templateId: '9' }) });
		const out = await node.execute.call(del.ctx);
		expect(del.calls[0]).toMatchObject({ method: 'DELETE', url: `${base}/9` });
		expect(out[0][0].json).toEqual({ deleted: true });

		const media = executeContext({
			handler: () => ({ body: { handle: '4::aW1h' } }),
			params: params('uploadExample', { binaryPropertyName: 'data', mimeType: '' }),
		});
		const handle = await node.execute.call(media.ctx);
		expect(media.calls[0]).toMatchObject({ method: 'POST', url: `${base}/media` });
		expect((media.calls[0].body as FormData).get('messaging_product')).toBeNull();
		expect(handle[0][0].json).toEqual({ handle: '4::aW1h' });
	});

	it('the id of a template is escaped in the path', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({ body: {} }),
			params: params('get', { templateId: '9/../../me' }),
		});
		await node.execute.call(ctx);
		expect(calls[0].url).toBe(`${base}/9%2F..%2F..%2Fme`);
	});

	it('structured components, or Components (JSON) which wins', () => {
		const structured = buildTemplateComponents(
			getter({
				tplHeader: 'Hi',
				tplBody: 'Body {{1}}',
				tplBodyExamples: 'a, b',
				tplFooter: 'Bye',
				tplButtons: { buttonValues: [{ type: 'URL', text: 'Open', url: 'https://x.com/{{1}}' }] },
			}),
			fail,
		);
		expect(structured.map((c) => c.type)).toEqual(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
		expect(buildTemplateComponents(getter({ tplBody: 'ignored', tplComponents: '[{"type":"BODY","text":"J"}]' }), fail)).toEqual([
			{ type: 'BODY', text: 'J' },
		]);
		expect(() => buildTemplateComponents(getter({}), fail)).toThrow(/Body Text is required/);
	});

	it('writing a template asks for the management scope in the 401', async () => {
		const { ctx } = executeContext({
			handler: () => ({ statusCode: 401, body: { error: 'Invalid or revoked key' } }),
			params: params('delete', { templateId: '9' }),
		});
		await expect(node.execute.call(ctx)).rejects.toBeTruthy();
		const error = (await node.execute.call(ctx).catch((e: unknown) => e)) as { description?: string };
		expect(error.description).toContain('"management" scope');
	});
});

describe('Conversation → Hand Off to Agent', () => {
	it('POST /v1/numbers/{pnid}/handoff with the customer in the body', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({ body: { success: true, status: 'pending' } }),
			params: { resource: 'conversation', operation: 'handOff', phoneNumberId: NUMBER, waId: '5511988887777' },
		});
		const out = await node.execute.call(ctx);
		expect(calls[0]).toMatchObject({
			method: 'POST',
			url: `${BASE}/v1/numbers/102290129340398/handoff`,
			body: { wa_id: '5511988887777' },
		});
		expect(out[0][0].json).toEqual({ success: true, status: 'pending' });
	});

	it('a plan without the inbox gets the clear message', async () => {
		const { ctx } = executeContext({
			handler: () => ({ statusCode: 403, body: { error: { message: 'This plan does not include the API', code: 1390004 } } }),
			params: { resource: 'conversation', operation: 'handOff', phoneNumberId: NUMBER, waId: '5511' },
		});
		await expect(node.execute.call(ctx)).rejects.toThrow(
			'Hand Off needs a plan with the inbox (not available on the Developer plan)',
		);
	});
});

describe('Flow → Send Flow: issues the token and sends in one action', () => {
	it('POST …/flows/{id}/token, then POST …/messages with the token in the flow action', async () => {
		const { ctx, calls } = executeContext({
			handler: (call) =>
				call.url.endsWith('/token')
					? { body: { flow_token: 'v1.abc.def', expires_at: '2026-01-08T00:00:00.000Z' } }
					: { body: { messages: [{ id: 'wamid.F' }] } },
			params: {
				resource: 'flow',
				operation: 'sendFlow',
				phoneNumberId: NUMBER,
				to: '5511988887777',
				flowId: '1234567890',
				flowBody: 'Fill in',
				flowCta: 'Open',
				flowScreen: 'WELCOME',
				flowScreenData: '{"name":"Maria"}',
				flowContext: '{"order":"A1"}',
			},
		});
		const out = await node.execute.call(ctx);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toMatchObject({
			method: 'POST',
			url: `${BASE}/v1/numbers/102290129340398/flows/1234567890/token`,
			body: { to: '5511988887777', context: { order: 'A1' } },
		});
		expect(calls[1].url).toBe(`${BASE}/v25.0/102290129340398/messages`);
		expect(calls[1].body).toEqual({
			messaging_product: 'whatsapp',
			to: '5511988887777',
			type: 'interactive',
			interactive: {
				type: 'flow',
				body: { text: 'Fill in' },
				action: {
					name: 'flow',
					parameters: {
						flow_message_version: '3',
						flow_token: 'v1.abc.def',
						flow_id: '1234567890',
						flow_cta: 'Open',
						flow_action: 'navigate',
						flow_action_payload: { screen: 'WELCOME', data: { name: 'Maria' } },
					},
				},
			},
		});
		expect(calls[1].headers).toHaveProperty('Idempotency-Key');
		expect(out[0][0].json).toMatchObject({ messages: [{ id: 'wamid.F' }], flow_id: '1234567890' });
	});

	it('a Flow ID that is not digits never reaches the API', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({}),
			params: {
				resource: 'flow',
				operation: 'sendFlow',
				phoneNumberId: NUMBER,
				to: '5511',
				flowId: '../x',
				flowBody: 'b',
				flowCta: 'c',
			},
		});
		await expect(node.execute.call(ctx)).rejects.toThrow(/Flow ID/);
		expect(calls).toHaveLength(0);
	});

	it('does not send when the token is refused', async () => {
		const { ctx, calls } = executeContext({
			handler: () => ({ statusCode: 409, body: { error: { message: "another provider's endpoint", code: 1390008 } } }),
			params: {
				resource: 'flow',
				operation: 'sendFlow',
				phoneNumberId: NUMBER,
				to: '5511',
				flowId: '12345',
				flowBody: 'b',
				flowCta: 'c',
			},
		});
		await expect(node.execute.call(ctx)).rejects.toThrow(/another provider/);
		expect(calls).toHaveLength(1);
	});
});
