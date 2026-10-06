import { createHmac, timingSafeEqual } from 'crypto';

// devtools.md §2.10 and §6.4 (S-44, S-45). Fail-closed: anything that is not exactly the documented format is "invalid",
// and the format and size are checked BEFORE the comparison. `verifySignature` never throws. The trigger only receives
// the deliveries of the API, and every one carries X-Synergy-Signature: there is NO fallback to the untimed
// X-Hub-Signature-256 (an attacker would strip the stronger header and replay a capture forever, RTF-02).

export const TOLERANCE_SECONDS = 300;

export type Headers = Record<string, string | string[] | undefined>;

export type SignatureResult =
	| { ok: true; timestamped: true; deliveryId: string }
	| { ok: false; reason: string };

const TIMESTAMPED = /^t=([^,]*),v1=([0-9a-f]{64})$/;
// The two format rules of the signed contract, copied IDENTICAL from the Synergy API (src/api/public/webhook-events.ts:
// SIGNATURE_T_PATTERN, DELIVERY_ID_PATTERN) and the SDK. The delivery id sits between two dots in `t.deliveryId.body`: a `.` (or any
// separator) inside it would let bytes move from the body into the id with the same HMAC (RTF-07). The server normalizes every id
// to this charset (T-417, T-418).
const SIGNATURE_T = /^\d{1,12}$/;
const DELIVERY_ID = /^[A-Za-z0-9_-]{1,200}$/;

function single(headers: Headers, name: string): string | null | undefined {
	const value = headers[name];
	if (value === undefined) return undefined;
	// a repeated header is two signatures: invalid
	if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
	return value;
}

function validDeliveryId(id: string | null | undefined): id is string {
	return typeof id === 'string' && DELIVERY_ID.test(id);
}

function hmac(secret: string, parts: Buffer[]): Buffer {
	const mac = createHmac('sha256', secret);
	for (const part of parts) mac.update(part);
	return mac.digest();
}

function equalHex(expected: Buffer, hex: string): boolean {
	const given = Buffer.from(hex, 'hex');
	return given.length === expected.length && timingSafeEqual(given, expected);
}

export function verifySignature(
	rawBody: Buffer | string,
	headers: Headers,
	secret: string,
	options: { nowSeconds?: number; toleranceSeconds?: number } = {},
): SignatureResult {
	try {
		if (typeof secret !== 'string' || secret.trim() === '') return { ok: false, reason: 'empty secret' };
		const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
		if (!Buffer.isBuffer(body)) return { ok: false, reason: 'body is not raw' };

		const deliveryHeader = single(headers, 'x-synergy-delivery-id');
		const timestamped = single(headers, 'x-synergy-signature');

		// X-Synergy-Signature is mandatory and decides alone: no header, or a bad one, is never rescued by X-Hub-Signature-256.
		if (timestamped === undefined) return { ok: false, reason: 'missing signature' };
		const match = timestamped === null ? null : TIMESTAMPED.exec(timestamped);
		if (!match || !SIGNATURE_T.test(match[1])) return { ok: false, reason: 'malformed signature' };
		const t = Number(match[1]);
		const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
		const tolerance = options.toleranceSeconds ?? TOLERANCE_SECONDS;
		if (!Number.isSafeInteger(t) || Math.abs(now - t) > tolerance) {
			return { ok: false, reason: 'timestamp outside the tolerance' };
		}
		if (!validDeliveryId(deliveryHeader)) return { ok: false, reason: 'missing delivery id' };
		const expected = hmac(secret, [Buffer.from(`${t}.${deliveryHeader}.`, 'utf8'), body]);
		if (!equalHex(expected, match[2])) return { ok: false, reason: 'signature mismatch' };
		return { ok: true, timestamped: true, deliveryId: deliveryHeader };
	} catch {
		return { ok: false, reason: 'verification error' };
	}
}
