import { describe, expect, it } from 'vitest';
import { TOLERANCE_SECONDS, verifySignature } from '../nodes/SynergyConnectTrigger/v1/signature';
import {
	SIGNATURE_EXAMPLE,
	TIMESTAMPED_SIGNATURE_EXAMPLE,
	hubSignature,
	timestampedSignature,
} from './helpers';

describe('signature: the two vectors of the contract', () => {
	it('X-Hub-Signature-256 vector (SIGNATURE_EXAMPLE) is NOT enough: no fallback in the trigger (RTF-02)', () => {
		const result = verifySignature(
			Buffer.from(SIGNATURE_EXAMPLE.body),
			{ 'x-hub-signature-256': SIGNATURE_EXAMPLE.header },
			SIGNATURE_EXAMPLE.signingKey,
		);
		expect(result).toEqual({ ok: false, reason: 'missing signature' });
	});

	it('X-Synergy-Signature vector (TIMESTAMPED_SIGNATURE_EXAMPLE), at the moment of the delivery', () => {
		const result = verifySignature(
			Buffer.from(TIMESTAMPED_SIGNATURE_EXAMPLE.body),
			{
				'x-synergy-signature': TIMESTAMPED_SIGNATURE_EXAMPLE.header,
				'x-synergy-delivery-id': TIMESTAMPED_SIGNATURE_EXAMPLE.deliveryId,
			},
			TIMESTAMPED_SIGNATURE_EXAMPLE.signingKey,
			{ nowSeconds: TIMESTAMPED_SIGNATURE_EXAMPLE.t },
		);
		expect(result).toEqual({
			ok: true,
			timestamped: true,
			deliveryId: TIMESTAMPED_SIGNATURE_EXAMPLE.deliveryId,
		});
	});

	it('our own HMAC helpers reproduce both vectors (the tests below sign with them)', () => {
		expect(hubSignature(SIGNATURE_EXAMPLE.body)).toBe(SIGNATURE_EXAMPLE.header);
		expect(
			timestampedSignature(
				TIMESTAMPED_SIGNATURE_EXAMPLE.body,
				TIMESTAMPED_SIGNATURE_EXAMPLE.deliveryId,
				TIMESTAMPED_SIGNATURE_EXAMPLE.t,
			),
		).toBe(TIMESTAMPED_SIGNATURE_EXAMPLE.header);
	});
});

describe('signature: tolerance and binding', () => {
	const headers = {
		'x-synergy-signature': TIMESTAMPED_SIGNATURE_EXAMPLE.header,
		'x-synergy-delivery-id': TIMESTAMPED_SIGNATURE_EXAMPLE.deliveryId,
	};
	const body = Buffer.from(TIMESTAMPED_SIGNATURE_EXAMPLE.body);
	const t = TIMESTAMPED_SIGNATURE_EXAMPLE.t;

	it('accepts up to 300 s on both sides, refuses beyond', () => {
		expect(TOLERANCE_SECONDS).toBe(300);
		for (const now of [t - 300, t + 300]) {
			expect(verifySignature(body, headers, SIGNATURE_EXAMPLE.signingKey, { nowSeconds: now }).ok).toBe(true);
		}
		for (const now of [t - 301, t + 301, t + 360]) {
			expect(verifySignature(body, headers, SIGNATURE_EXAMPLE.signingKey, { nowSeconds: now }).ok).toBe(false);
		}
	});

	it('the delivery id is part of what is signed: another id, or none, fails', () => {
		const other = { ...headers, 'x-synergy-delivery-id': 'ping-other' };
		expect(verifySignature(body, other, SIGNATURE_EXAMPLE.signingKey, { nowSeconds: t }).ok).toBe(false);
		const none = { 'x-synergy-signature': headers['x-synergy-signature'] };
		expect(verifySignature(body, none, SIGNATURE_EXAMPLE.signingKey, { nowSeconds: t }).ok).toBe(false);
	});

	it('a bad X-Synergy-Signature never falls back to X-Hub-Signature-256', () => {
		const downgraded = {
			'x-synergy-signature': `t=${t},v1=${'0'.repeat(64)}`,
			'x-synergy-delivery-id': TIMESTAMPED_SIGNATURE_EXAMPLE.deliveryId,
			'x-hub-signature-256': SIGNATURE_EXAMPLE.header,
		};
		expect(verifySignature(body, downgraded, SIGNATURE_EXAMPLE.signingKey, { nowSeconds: t }).ok).toBe(false);
	});

	it('another secret, another body: invalid', () => {
		expect(verifySignature(body, headers, 'f'.repeat(32), { nowSeconds: t }).ok).toBe(false);
		expect(
			verifySignature(Buffer.from(`${TIMESTAMPED_SIGNATURE_EXAMPLE.body} `), headers, SIGNATURE_EXAMPLE.signingKey, {
				nowSeconds: t,
			}).ok,
		).toBe(false);
	});

	it('an empty secret never validates', () => {
		for (const secret of ['', '   ']) {
			const result = verifySignature(
				Buffer.from(SIGNATURE_EXAMPLE.body),
				{ 'x-hub-signature-256': hubSignature(SIGNATURE_EXAMPLE.body, secret) },
				secret,
			);
			expect(result.ok).toBe(false);
		}
	});
});
