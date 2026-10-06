import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SynergyConnectTriggerV1 } from '../nodes/SynergyConnectTrigger/v1/SynergyConnectTriggerV1.node';
import {
	HOOK_URL,
	SECRET,
	SIGNATURE_EXAMPLE,
	TEST_HOOK_URL,
	TIMESTAMPED_SIGNATURE_EXAMPLE,
	envelope,
	hubSignature,
	messageChange,
	registered,
	statusChange,
	textMessage,
	timestampedSignature,
	webhookContext,
} from './helpers';

const node = new SynergyConnectTriggerV1({
	displayName: 'Synergy Connect Trigger',
	name: 'synergyConnectTrigger',
	icon: 'file:synergyConnect.svg',
	group: ['trigger'],
	description: '',
});

const NOW = TIMESTAMPED_SIGNATURE_EXAMPLE.t;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(NOW * 1000));
});
afterEach(() => vi.useRealTimers());

const sign = (body: string, deliveryId = 'ev-0123456789abcdef01234567-abcd1234') => ({
	'x-synergy-signature': timestampedSignature(body, deliveryId, NOW),
	'x-synergy-delivery-id': deliveryId,
});

describe('webhook(): a signed delivery runs the workflow', () => {
	it('X-Synergy-Signature: items carry the delivery metadata', async () => {
		const body = envelope([messageChange(textMessage)]);
		const { ctx, res } = webhookContext({
			rawBody: Buffer.from(body),
			headers: { ...sign(body), 'x-synergy-instance-id': 'b'.repeat(64) },
			staticData: registered(),
		});
		const out = await node.webhook.call(ctx);
		expect(res.status).not.toHaveBeenCalled();
		expect(out.workflowData?.[0]).toHaveLength(1);
		expect(out.workflowData?.[0][0].json).toMatchObject({
			_deliveryId: 'ev-0123456789abcdef01234567-abcd1234',
			_timestamped: true,
			_eventType: 'messages',
			_instanceId: 'b'.repeat(64),
			_wabaId: '1029384756',
		});
	});

	it('X-Hub-Signature-256 only (no X-Synergy-Signature): refused with 401, no fallback (RTF-02)', async () => {
		const body = envelope([messageChange(textMessage)]);
		const { ctx, res } = webhookContext({
			rawBody: Buffer.from(body),
			headers: { 'x-hub-signature-256': hubSignature(body) },
			staticData: registered(),
		});
		const out = await node.webhook.call(ctx);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(out.workflowData).toBeUndefined();
	});

	it('routes to the output of the subtype, with the status filter applied', async () => {
		const body = envelope([
			messageChange({ id: 'w', from: '1', type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: {} } }),
			statusChange('sent'),
			statusChange('read'),
		]);
		const { ctx } = webhookContext({
			rawBody: Buffer.from(body),
			headers: sign(body),
			staticData: registered(),
			params: { events: ['messages', 'statuses'], outputMode: 'perMessageSubtype', statusFilter: ['read'] },
		});
		const out = await node.webhook.call(ctx);
		const sizes = (out.workflowData ?? []).map((o) => o.length);
		// 14 subtypes + 1 status output
		expect(sizes).toHaveLength(15);
		expect(sizes[11]).toBe(1); // Flow Response
		expect(sizes[14]).toBe(1); // Message Status (read only)
		expect(sizes.reduce((a, b) => a + b, 0)).toBe(2);
	});
});

describe('webhook(): ping without execution', () => {
	it('the signed ping of the vector answers 200 and never runs the workflow', async () => {
		const { ctx, res } = webhookContext({
			rawBody: Buffer.from(TIMESTAMPED_SIGNATURE_EXAMPLE.body),
			headers: {
				'x-synergy-signature': TIMESTAMPED_SIGNATURE_EXAMPLE.header,
				'x-synergy-delivery-id': TIMESTAMPED_SIGNATURE_EXAMPLE.deliveryId,
			},
			staticData: registered(),
		});
		const out = await node.webhook.call(ctx);
		expect(out.workflowData).toBeUndefined();
		expect(out.noWebhookResponse).toBeUndefined();
		expect(out.webhookResponse).toBe('OK');
		expect(res.status).not.toHaveBeenCalled();
	});

	it('the ping with only the X-Hub-Signature-256 vector is refused: no fallback (RTF-02)', async () => {
		const { ctx, res } = webhookContext({
			rawBody: Buffer.from(SIGNATURE_EXAMPLE.body),
			headers: { 'x-hub-signature-256': SIGNATURE_EXAMPLE.header },
			staticData: registered(),
		});
		const out = await node.webhook.call(ctx);
		expect(out.workflowData).toBeUndefined();
		expect(res.status).toHaveBeenCalledWith(401);
	});

	it('the proof ping of create(): no state yet (the secret is not known), still 200 and no execution', async () => {
		const { ctx, res } = webhookContext({
			rawBody: Buffer.from(SIGNATURE_EXAMPLE.body),
			headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
			staticData: {},
		});
		const out = await node.webhook.call(ctx);
		expect(out.workflowData).toBeUndefined();
		expect(out.webhookResponse).toBe('OK');
		expect(res.status).not.toHaveBeenCalled();
	});

	it('but with no state, anything that is not a ping-only body is refused', async () => {
		const body = envelope([messageChange(textMessage)]);
		const { ctx, res } = webhookContext({ rawBody: Buffer.from(body), headers: sign(body), staticData: {} });
		const out = await node.webhook.call(ctx);
		expect(out.noWebhookResponse).toBe(true);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});

describe('webhook(): the envelope of an Instagram account', () => {
	it('signed and valid: 200 and no item', async () => {
		const body = JSON.stringify({
			object: 'instagram',
			entry: [{ id: '17841400000000000', time: 1, changes: [{ field: 'messages', value: { messages: [textMessage] } }] }],
		});
		const { ctx, res } = webhookContext({ rawBody: Buffer.from(body), headers: sign(body), staticData: registered() });
		const out = await node.webhook.call(ctx);
		expect(out.workflowData).toBeUndefined();
		expect(out.webhookResponse).toBe('OK');
		expect(res.status).not.toHaveBeenCalled();
	});

	it('not signed: still 401', async () => {
		const body = JSON.stringify({ object: 'instagram', entry: [] });
		const { ctx, res } = webhookContext({ rawBody: Buffer.from(body), headers: {}, staticData: registered() });
		const out = await node.webhook.call(ctx);
		expect(out.noWebhookResponse).toBe(true);
		expect(res.status).toHaveBeenCalledWith(401);
	});
});

describe('webhook(): state by URL (E1-11)', () => {
	it('the production and the test URL of one workflow keep their own secret', async () => {
		const other = 'f'.repeat(32);
		const staticData = {
			hooks: {
				[HOOK_URL]: { id: 'prod', secret: SECRET },
				[TEST_HOOK_URL]: { id: 'test', secret: other },
			},
		};
		const body = envelope([messageChange(textMessage)]);
		const headers = sign(body);

		// signed with the secret of production: valid on the production URL, 401 on the test URL
		const prod = webhookContext({ rawBody: Buffer.from(body), headers, staticData, url: HOOK_URL });
		expect((await node.webhook.call(prod.ctx)).workflowData).toBeDefined();
		const test = webhookContext({ rawBody: Buffer.from(body), headers, staticData, url: TEST_HOOK_URL });
		expect((await node.webhook.call(test.ctx)).noWebhookResponse).toBe(true);
		expect(test.res.status).toHaveBeenCalledWith(401);

		// and the other way around
		const signedTest = {
			'x-synergy-signature': timestampedSignature(body, 'ev-1-x', NOW, other),
			'x-synergy-delivery-id': 'ev-1-x',
		};
		const ok = webhookContext({ rawBody: Buffer.from(body), headers: signedTest, staticData, url: TEST_HOOK_URL });
		expect((await node.webhook.call(ok.ctx)).workflowData).toBeDefined();
	});
});
