import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SynergyConnectTriggerV1 } from '../../nodes/SynergyConnectTrigger/v1/SynergyConnectTriggerV1.node';
import { createHook } from '../../nodes/SynergyConnectTrigger/v1/lifecycle';
import {
	HOOK_URL,
	SECRET,
	SIGNATURE_EXAMPLE,
	TIMESTAMPED_SIGNATURE_EXAMPLE,
	envelope,
	hookContext,
	hubSignature,
	messageChange,
	registered,
	textMessage,
	timestampedSignature,
	webhookContext,
} from '../helpers';

// S-44, S-45 and S-46 of devtools.md §8, against the trigger of the node (§6.4). Each attack is a delivery that must
// get a 401 and must never start the workflow.

const node = new SynergyConnectTriggerV1({
	displayName: 'Synergy Connect Trigger',
	name: 'synergyConnectTrigger',
	icon: 'file:synergyConnect.svg',
	group: ['trigger'],
	description: '',
});

const NOW = TIMESTAMPED_SIGNATURE_EXAMPLE.t;
const DELIVERY = 'ev-0123456789abcdef01234567-abcd1234';

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(NOW * 1000));
});
afterEach(() => vi.useRealTimers());

const REAL = envelope([messageChange(textMessage)]);

async function deliver(options: {
	rawBody?: Buffer | string;
	headers?: Record<string, string | string[]>;
	staticData?: Record<string, unknown>;
}) {
	const { ctx, res, logger } = webhookContext({
		rawBody: options.rawBody,
		headers: options.headers ?? {},
		staticData: options.staticData ?? registered(),
	});
	const out = await node.webhook.call(ctx);
	return { out, res, logger };
}

function expectRefused({ out, res }: Awaited<ReturnType<typeof deliver>>) {
	expect(res.status).toHaveBeenCalledWith(401);
	expect(out.noWebhookResponse).toBe(true);
	expect(out.workflowData).toBeUndefined();
}

const goodTimestamped = (body: string = REAL) => ({
	'x-synergy-signature': timestampedSignature(body, DELIVERY, NOW),
	'x-synergy-delivery-id': DELIVERY,
});

it('control: the same delivery, correctly signed, runs the workflow', async () => {
	const { out, res } = await deliver({ rawBody: Buffer.from(REAL), headers: goodTimestamped() });
	expect(res.status).not.toHaveBeenCalled();
	expect(out.workflowData?.[0]).toHaveLength(1);
});

describe('blocked: S-44 (timestamped signature, 300 s)', () => {
	it('blocked: S-44 a timestamp 6 minutes old → 401', async () => {
		const t = NOW - 360;
		const headers = {
			'x-synergy-signature': timestampedSignature(REAL, DELIVERY, t),
			'x-synergy-delivery-id': DELIVERY,
		};
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});

	it('blocked: S-44 a timestamp 6 minutes in the future → 401', async () => {
		const t = NOW + 360;
		const headers = {
			'x-synergy-signature': timestampedSignature(REAL, DELIVERY, t),
			'x-synergy-delivery-id': DELIVERY,
		};
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});

	it('blocked: S-44 a captured delivery replayed later (same bytes, same headers) → 401', async () => {
		const headers = goodTimestamped();
		expect((await deliver({ rawBody: Buffer.from(REAL), headers })).res.status).not.toHaveBeenCalled();
		vi.setSystemTime(new Date((NOW + 360) * 1000));
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});

	it('blocked: S-44 the delivery id swapped → 401', async () => {
		const headers = { ...goodTimestamped(), 'x-synergy-delivery-id': 'ev-ffffffffffffffffffffffff-abcd1234' };
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});

	it('blocked: S-44 the delivery id removed → 401', async () => {
		const headers = { 'x-synergy-signature': goodTimestamped()['x-synergy-signature'] };
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});

	it('blocked: S-44 a wrong X-Synergy-Signature next to a valid X-Hub-Signature-256 (downgrade) → 401', async () => {
		const headers = {
			'x-synergy-signature': `t=${NOW},v1=${'a'.repeat(64)}`,
			'x-synergy-delivery-id': DELIVERY,
			'x-hub-signature-256': hubSignature(REAL),
		};
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});

	it('blocked: S-44 the vector of the contract with another body → 401', async () => {
		const headers = {
			'x-synergy-signature': TIMESTAMPED_SIGNATURE_EXAMPLE.header,
			'x-synergy-delivery-id': TIMESTAMPED_SIGNATURE_EXAMPLE.deliveryId,
		};
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});
});

describe('blocked: S-45 (fail-closed verification)', () => {
	const valid = hubSignature(REAL);
	const hex = valid.slice('sha256='.length);

	const hubTable: [string, string][] = [
		['signature too short', `sha256=${hex.slice(0, 62)}`],
		['signature too long', `sha256=${hex}00`],
		['invalid hex', `sha256=${'g'.repeat(64)}`],
		['uppercase hex', `sha256=${hex.toUpperCase()}`],
		['no prefix', hex],
		['wrong prefix', `sha1=${hex}`],
		['two signatures in one header', `${valid},${valid}`],
		['trailing space', `${valid} `],
		['empty', ''],
	];
	for (const [name, header] of hubTable) {
		it(`blocked: S-45 X-Hub-Signature-256: ${name} → 401`, async () => {
			expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers: { 'x-hub-signature-256': header } }));
		});
	}

	const synergyTable: [string, string][] = [
		['v1 too short', `t=${NOW},v1=${'a'.repeat(63)}`],
		['v1 too long', `t=${NOW},v1=${'a'.repeat(65)}`],
		['invalid hex', `t=${NOW},v1=${'z'.repeat(64)}`],
		['uppercase hex', `t=${NOW},v1=${'A'.repeat(64)}`],
		['no t', `v1=${'a'.repeat(64)}`],
		['t not an integer', `t=1.5,v1=${'a'.repeat(64)}`],
		['t negative', `t=-1,v1=${'a'.repeat(64)}`],
		['t huge', `t=${'9'.repeat(40)},v1=${'a'.repeat(64)}`],
		['two v1', `t=${NOW},v1=${'a'.repeat(64)},v1=${'b'.repeat(64)}`],
		['empty', ''],
	];
	for (const [name, header] of synergyTable) {
		it(`blocked: S-45 X-Synergy-Signature: ${name} → 401`, async () => {
			const headers = { 'x-synergy-signature': header, 'x-synergy-delivery-id': DELIVERY };
			expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
		});
	}

	it('blocked: S-45 the same header twice (two signatures) → 401', async () => {
		const good = goodTimestamped()['x-synergy-signature'];
		const headers = { 'x-synergy-signature': [good, good], 'x-synergy-delivery-id': DELIVERY };
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});

	it('blocked: S-45 no signature at all → 401', async () => {
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers: {} }));
	});

	it('blocked: S-45 no rawBody (a parsed body must never be re-serialized) → 401', async () => {
		const outcome = await deliver({ rawBody: undefined, headers: goodTimestamped() });
		expectRefused(outcome);
	});

	it('blocked: S-45 a rawBody that is not bytes or text → 401', async () => {
		const { ctx, res } = webhookContext({
			rawBody: { not: 'bytes' } as unknown as Buffer,
			headers: goodTimestamped(),
			staticData: registered(),
		});
		const out = await node.webhook.call(ctx);
		expect(res.status).toHaveBeenCalledWith(401);
		expect(out.noWebhookResponse).toBe(true);
	});

	it('blocked: S-45 a signature over the re-serialized JSON is not the signature of the bytes → 401', async () => {
		const spaced = `{ "object": "whatsapp_business_account", "entry": ${JSON.stringify(JSON.parse(REAL).entry)} }`;
		expectRefused(await deliver({ rawBody: Buffer.from(spaced), headers: goodTimestamped() }));
	});

	it('blocked: S-45 an empty secret in the state → 401, even with a signature made with the empty secret, and logs', async () => {
		for (const secret of ['', '   ']) {
			const headers = {
				'x-synergy-signature': timestampedSignature(REAL, DELIVERY, NOW, secret),
				'x-synergy-delivery-id': DELIVERY,
			};
			const outcome = await deliver({
				rawBody: Buffer.from(REAL),
				headers,
				staticData: registered(HOOK_URL, secret),
			});
			expectRefused(outcome);
			expect(outcome.logger.error).toHaveBeenCalledOnce();
		}
	});

	it('blocked: S-45 a ping plus a message without a signature → 401 and zero items', async () => {
		const body = envelope([
			{ field: 'synergy_ping', value: { ping: true } },
			messageChange(textMessage),
		]);
		expectRefused(await deliver({ rawBody: Buffer.from(body), headers: {} }));
	});

	it('blocked: S-45 a ping plus a message WITH a valid signature is not a ping: the message runs the workflow', async () => {
		const body = envelope([
			{ field: 'synergy_ping', value: { ping: true } },
			messageChange(textMessage),
		]);
		const { out } = await deliver({ rawBody: Buffer.from(body), headers: goodTimestamped(body) });
		expect(out.workflowData?.[0]).toHaveLength(1);
	});

	it('blocked: S-45 an unsigned ping when a secret exists → 401 (the ping answer comes only after the signature)', async () => {
		expectRefused(await deliver({ rawBody: Buffer.from(SIGNATURE_EXAMPLE.body), headers: {} }));
	});

	it('blocked: S-45 a signed body that is not JSON → 200, no execution, no crash', async () => {
		const body = 'not json at all';
		const { out, res } = await deliver({ rawBody: Buffer.from(body), headers: goodTimestamped(body) });
		expect(res.status).not.toHaveBeenCalled();
		expect(out.workflowData).toBeUndefined();
	});

	it('blocked: S-45 a signature made with another secret → 401', async () => {
		const headers = {
			'x-synergy-signature': timestampedSignature(REAL, DELIVERY, NOW, 'f'.repeat(32)),
			'x-synergy-delivery-id': DELIVERY,
		};
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});

	it('blocked: S-45 no state for this URL and a real event → 401 (nothing to verify with)', async () => {
		const outcome = await deliver({ rawBody: Buffer.from(REAL), headers: goodTimestamped(), staticData: {} });
		expectRefused(outcome);
	});
});

describe('blocked: AK-03 instagram (the envelope of an Instagram account)', () => {
	it('blocked: AK-03 instagram a signed object: instagram envelope → 200 without an item', async () => {
		const body = JSON.stringify({
			object: 'instagram',
			entry: [
				{
					id: '17841400000000000',
					time: 1,
					changes: [{ field: 'messages', value: { messages: [textMessage] } }],
				},
			],
		});
		const { out, res } = await deliver({ rawBody: Buffer.from(body), headers: goodTimestamped(body) });
		expect(res.status).not.toHaveBeenCalled();
		expect(out.workflowData).toBeUndefined();
	});

	it('blocked: AK-03 instagram an unsigned object: instagram envelope → 401', async () => {
		const body = JSON.stringify({ object: 'instagram', entry: [] });
		expectRefused(await deliver({ rawBody: Buffer.from(body), headers: {} }));
	});
});

describe('blocked: S-46 (the key does not leave the credential origin)', () => {
	it('blocked: S-46 a credential with http:// → error before any call', async () => {
		const { ctx, calls } = hookContext({
			handler: () => ({}),
			credentials: { apiKey: 'syn_x', baseUrl: 'http://api.synergyconnect.com.br' },
		});
		await expect(createHook(ctx)).rejects.toThrow('The Synergy Connect API URL must use https.');
		expect(calls).toHaveLength(0);
	});

	it('blocked: S-46 a credential whose Base URL has a path → error before any call', async () => {
		const { ctx, calls } = hookContext({
			handler: () => ({}),
			credentials: { apiKey: 'syn_x', baseUrl: 'https://synergyconnect.com.br/api/v1' },
		});
		await expect(createHook(ctx)).rejects.toThrow(/with no path/);
		expect(calls).toHaveLength(0);
	});

	it('blocked: S-46 a redirect is never followed and carries no second call with the key', async () => {
		const { ctx, calls, request } = hookContext({
			handler: () => ({ statusCode: 302, headers: { location: 'https://evil.example/steal' } }),
		});
		await expect(createHook(ctx)).rejects.toThrow(/redirect/);
		expect(calls).toHaveLength(1);
		expect(request.mock.calls[0][1]).toMatchObject({ disableFollowRedirect: true });
	});

	it('blocked: S-46 errors do not carry the key', async () => {
		const { ctx } = hookContext({
			handler: () => ({ statusCode: 401, body: { error: 'Invalid or revoked key' } }),
			credentials: { apiKey: 'syn_topsecretvalue', baseUrl: 'https://api.synergyconnect.com.br' },
		});
		const error = (await createHook(ctx).catch((e: unknown) => e)) as Error;
		const dump = JSON.stringify(error, Object.getOwnPropertyNames(error)) + String(error);
		expect(dump).not.toContain('syn_topsecretvalue');
	});

	it('blocked: S-46 the webhook URL of n8n must be a public https address', async () => {
		for (const url of ['http://n8n.example.com/webhook/x', 'https://localhost/webhook/x', 'https://10.1.2.3/webhook/x']) {
			const { ctx, calls } = hookContext({ handler: () => ({}), url });
			await expect(createHook(ctx)).rejects.toBeTruthy();
			expect(calls).toHaveLength(0);
		}
	});
});

it('the secret in the state is the only thing that opens a delivery: the contract vector does not', async () => {
	// SECRET is the secret of the public test vectors: a real webhook never has it, and a delivery signed with the
	// vector's header over another body is refused
	expect(SECRET).toBe(SIGNATURE_EXAMPLE.signingKey);
	expectRefused(
		await deliver({
			rawBody: Buffer.from(REAL),
			headers: {
				'x-synergy-signature': TIMESTAMPED_SIGNATURE_EXAMPLE.header,
				'x-synergy-delivery-id': TIMESTAMPED_SIGNATURE_EXAMPLE.deliveryId,
			},
		}),
	);
});

describe('blocked: RTF-02 (S-44) the trigger has no fallback to the untimed X-Hub-Signature-256', () => {
	it('blocked: RTF-02 a valid X-Hub-Signature-256 alone (the header stripped from a captured delivery) → 401', async () => {
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers: { 'x-hub-signature-256': hubSignature(REAL) } }));
	});

	it('blocked: RTF-02 the same capture with only the delivery id and the Hub signature, replayed a month later → 401', async () => {
		vi.setSystemTime(new Date((NOW + 30 * 86_400) * 1000));
		const headers = { 'x-hub-signature-256': hubSignature(REAL), 'x-synergy-delivery-id': DELIVERY };
		expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
	});
});

describe('blocked: RTF-07 (S-44) the delivery id format, checked before the HMAC', () => {
	const ids: [string, string][] = [
		['a dot (bytes moved from the body into the id)', `${DELIVERY}.${REAL.slice(0, REAL.indexOf('.'))}`],
		['a colon', 'ev-1:abcd1234'],
		['a plus', 'ev-1+2'],
		['a space', 'ev 1'],
		['a newline', 'ev-1\n'],
		['more than 200 characters', 'a'.repeat(201)],
	];
	for (const [name, id] of ids) {
		it(`blocked: RTF-07 delivery id with ${name} → 401, even when the HMAC is right for it`, async () => {
			const headers = { 'x-synergy-signature': timestampedSignature(REAL, id, NOW), 'x-synergy-delivery-id': id };
			expectRefused(await deliver({ rawBody: Buffer.from(REAL), headers }));
		});
	}

	it('control: 200 characters of [A-Za-z0-9_-] are accepted', async () => {
		const id = `${'a'.repeat(100)}_-${'Z9'.repeat(49)}`;
		const headers = { 'x-synergy-signature': timestampedSignature(REAL, id, NOW), 'x-synergy-delivery-id': id };
		const { out } = await deliver({ rawBody: Buffer.from(REAL), headers });
		expect(out.workflowData?.[0]).toHaveLength(1);
	});
});
