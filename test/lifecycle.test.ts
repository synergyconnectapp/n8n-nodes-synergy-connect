import { describe, expect, it, vi } from 'vitest';
import { checkExists, createHook, deleteHook } from '../nodes/SynergyConnectTrigger/v1/lifecycle';
import { HOOK_URL, SECRET, TEST_HOOK_URL, hookContext, registered } from './helpers';

const row = (over: Record<string, unknown> = {}) => ({
	id: 'hook-1',
	url: HOOK_URL,
	name: 'n8n · Atendimento · prod',
	fields: ['messages'],
	statuses: null,
	instanceIds: null,
	enabled: true,
	...over,
});

const noWait = vi.fn(async () => {});

describe('create()', () => {
	it('registers the webhook on the new API and stores { id, secret } under its URL', async () => {
		const { ctx, calls, staticData } = hookContext({
			handler: () => ({ statusCode: 201, body: { row: row(), secret: SECRET, pending: 0 } }),
			params: { events: ['messages', 'statuses'], statusFilter: ['read'], phoneNumbers: ['a'.repeat(64)] },
		});
		expect(await createHook(ctx, noWait)).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe('POST');
		expect(calls[0].url).toBe('https://api.synergyconnect.com.br/v1/webhooks');
		expect(calls[0].body).toEqual({
			url: HOOK_URL,
			name: 'n8n · Atendimento · prod',
			fields: ['messages', 'statuses'],
			statuses: ['read'],
			instanceIds: ['a'.repeat(64)],
			verification: 'ping',
		});
		expect(staticData.hooks).toEqual({ [HOOK_URL]: { id: 'hook-1', secret: SECRET } });
	});

	it('no numbers chosen means all of the key (instanceIds null); test mode is named ·test', async () => {
		const { ctx, calls } = hookContext({
			handler: () => ({ statusCode: 201, body: { row: row({ url: TEST_HOOK_URL }), secret: SECRET } }),
			url: TEST_HOOK_URL,
			mode: 'manual',
		});
		await createHook(ctx, noWait);
		expect(calls[0].body).toMatchObject({ instanceIds: null, statuses: null, name: 'n8n · Atendimento · test' });
	});

	it('refuses http:, localhost and private addresses before calling the API', async () => {
		for (const url of [
			'http://n8n.example.com/webhook/x',
			'https://localhost:5678/webhook/x',
			'https://127.0.0.1/webhook/x',
			'https://192.168.1.10/webhook/x',
			'https://10.0.0.5/webhook/x',
			'https://172.20.1.1/webhook/x',
			'https://[::1]/webhook/x',
			'https://box.local/webhook/x',
		]) {
			const { ctx, calls } = hookContext({ handler: () => ({}), url });
			await expect(createHook(ctx, noWait), url).rejects.toThrow(/https|private/);
			expect(calls, url).toHaveLength(0);
		}
	});

	it('a stale entry is dropped before the call, so the proof ping of the API is answered without a secret', async () => {
		let during: unknown;
		const handler = () => {
			during = structuredClone(staticDataRef.hooks);
			return { statusCode: 201, body: { row: row(), secret: SECRET } };
		};
		const made = hookContext({ handler, staticData: registered(HOOK_URL, 'old') });
		const staticDataRef = made.staticData as { hooks?: unknown };
		await createHook(made.ctx, noWait);
		expect(during).toEqual({});
	});

	it('429: waits Retry-After once (up to 60 s) and tries again', async () => {
		let n = 0;
		const wait = vi.fn(async () => {});
		const { ctx, calls } = hookContext({
			handler: () =>
				++n === 1
					? { statusCode: 429, headers: { 'retry-after': '7' }, body: { error: 'Rate limit hit' } }
					: { statusCode: 201, body: { row: row(), secret: SECRET } },
		});
		expect(await createHook(ctx, wait)).toBe(true);
		expect(wait).toHaveBeenCalledWith(7000);
		expect(calls).toHaveLength(2);
	});

	it('429 with a long Retry-After, or a second 429: gives up with the API error', async () => {
		const wait = vi.fn(async () => {});
		const long = hookContext({
			handler: () => ({ statusCode: 429, headers: { 'retry-after': '300' }, body: {} }),
		});
		await expect(createHook(long.ctx, wait)).rejects.toThrow(/rate limit/i);
		expect(wait).not.toHaveBeenCalled();

		const twice = hookContext({ handler: () => ({ statusCode: 429, headers: { 'retry-after': '1' }, body: {} }) });
		await expect(createHook(twice.ctx, wait)).rejects.toThrow(/rate limit/i);
		expect(twice.calls).toHaveLength(2);
	});

	it('explains the 403 of a key without the management scope', async () => {
		const { ctx } = hookContext({ handler: () => ({ statusCode: 403, body: { error: 'forbidden' } }) });
		await expect(createHook(ctx, noWait)).rejects.toThrow(/refused the operation \(403\)/);
	});

	it('refuses a credential with a path or in cleartext before any call (S-46)', async () => {
		for (const baseUrl of ['https://api.synergyconnect.com.br/api/v1', 'http://api.synergyconnect.com.br']) {
			const { ctx, calls } = hookContext({ handler: () => ({}), credentials: { apiKey: 'syn_x', baseUrl } });
			await expect(createHook(ctx, noWait)).rejects.toThrow(/with no path|must use https/);
			expect(calls).toHaveLength(0);
		}
	});
});

describe('checkExists()', () => {
	it('already registered and the secret is known: true, no second endpoint', async () => {
		const { ctx, calls } = hookContext({
			handler: () => ({ body: { data: [row()] } }),
			staticData: registered(),
		});
		expect(await checkExists(ctx, noWait)).toBe(true);
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET https://api.synergyconnect.com.br/v1/webhooks']);
	});

	it('the state was lost but the endpoint is ours (name n8n · …): rotates the secret and keeps it', async () => {
		const { ctx, calls, staticData } = hookContext({
			handler: (c) =>
				c.method === 'GET'
					? { body: { data: [row()] } }
					: { body: { secret: 'e'.repeat(32), pending: 0 } },
		});
		expect(await checkExists(ctx, noWait)).toBe(true);
		expect(calls[1].method).toBe('POST');
		expect(calls[1].url).toBe('https://api.synergyconnect.com.br/v1/webhooks/hook-1/rotate-secret');
		expect(calls[1].body).toBeUndefined();
		expect(staticData.hooks).toEqual({ [HOOK_URL]: { id: 'hook-1', secret: 'e'.repeat(32) } });
	});

	it('an endpoint at this URL that n8n did not create is not taken over', async () => {
		const { ctx, calls } = hookContext({ handler: () => ({ body: { data: [row({ name: 'my own' })] } }) });
		await expect(checkExists(ctx, noWait)).rejects.toThrow(/not created by n8n/);
		expect(calls).toHaveLength(1);
	});

	it('not in the list: false, and only the entry of THIS url is dropped', async () => {
		const { ctx, staticData } = hookContext({
			handler: () => ({ body: { data: [row({ url: 'https://other.example.com/x' })] } }),
			staticData: {
				hooks: {
					[HOOK_URL]: { id: 'hook-1', secret: SECRET },
					[TEST_HOOK_URL]: { id: 'hook-2', secret: SECRET },
				},
			},
		});
		expect(await checkExists(ctx, noWait)).toBe(false);
		expect(Object.keys(staticData.hooks as object)).toEqual([TEST_HOOK_URL]);
	});

	it('events changed in the node: patches the subscription', async () => {
		const { ctx, calls } = hookContext({
			handler: () => ({ body: { data: [row()] } }),
			staticData: registered(),
			params: { events: ['messages', 'synergy_conversations'] },
		});
		expect(await checkExists(ctx, noWait)).toBe(true);
		expect(calls[1].method).toBe('PATCH');
		expect(calls[1].body).toMatchObject({ fields: ['messages', 'synergy_conversations'], enabled: true });
	});
});

describe('delete()', () => {
	it('deletes the endpoint of this URL and drops only its entry', async () => {
		const { ctx, calls, staticData } = hookContext({
			handler: () => ({ body: { ok: true, pending: 0 } }),
			staticData: {
				hooks: {
					[HOOK_URL]: { id: 'hook-1', secret: SECRET },
					[TEST_HOOK_URL]: { id: 'hook-2', secret: SECRET },
				},
			},
			url: TEST_HOOK_URL,
			mode: 'manual',
		});
		expect(await deleteHook(ctx, noWait)).toBe(true);
		expect(calls[0].method).toBe('DELETE');
		expect(calls[0].url).toBe('https://api.synergyconnect.com.br/v1/webhooks/hook-2');
		expect(Object.keys(staticData.hooks as object)).toEqual([HOOK_URL]);
	});

	it('404 means it is already gone: ok', async () => {
		const { ctx, staticData } = hookContext({
			handler: () => ({ statusCode: 404, body: { error: 'Webhook not found' } }),
			staticData: registered(),
		});
		expect(await deleteHook(ctx, noWait)).toBe(true);
		expect(staticData.hooks).toEqual({});
	});

	it('another error keeps the entry and reports false', async () => {
		const { ctx, staticData } = hookContext({
			handler: () => ({ statusCode: 500, body: {} }),
			staticData: registered(),
		});
		expect(await deleteHook(ctx, noWait)).toBe(false);
		expect(Object.keys(staticData.hooks as object)).toEqual([HOOK_URL]);
	});
});
