import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest, pathPart } from '../transport';
import { postMessage } from './message';

function jsonObject(ctx: IExecuteFunctions, i: number, name: string, label: string): IDataObject | undefined {
	const raw = ctx.getNodeParameter(name, i, '') as string | IDataObject;
	if (raw === '' || raw === undefined) return undefined;
	let value: unknown = raw;
	if (typeof raw === 'string') {
		try {
			value = JSON.parse(raw);
		} catch {
			throw new NodeOperationError(ctx.getNode(), `${label} is not valid JSON`, { itemIndex: i });
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new NodeOperationError(ctx.getNode(), `${label} must be a JSON object`, { itemIndex: i });
	}
	return value as IDataObject;
}

// Send Flow: issue the flow token, then send the flow with it, in one action (devtools.md §6.3).
export async function handleFlow(
	ctx: IExecuteFunctions,
	i: number,
	phoneNumberId: string,
	operation: string,
): Promise<IDataObject> {
	if (operation !== 'sendFlow') {
		throw new NodeOperationError(ctx.getNode(), `Unknown flow operation: ${operation}`, { itemIndex: i });
	}
	const to = ctx.getNodeParameter('to', i) as string;
	const flowId = String(ctx.getNodeParameter('flowId', i)).trim();
	if (!/^\d{5,25}$/.test(flowId)) {
		throw new NodeOperationError(ctx.getNode(), 'The Flow ID must be 5 to 25 digits.', { itemIndex: i });
	}

	const tokenBody: IDataObject = { to };
	const context = jsonObject(ctx, i, 'flowContext', 'Token Context');
	if (context) tokenBody.context = context;
	const token = (
		await apiRequest(ctx, {
			method: 'POST',
			path: `/v1/numbers/${pathPart(phoneNumberId)}/flows/${pathPart(flowId)}/token`,
			scope: 'messages',
			body: tokenBody,
			itemIndex: i,
			hints: { planMessage: 'Send Flow needs a plan with WhatsApp Flows' },
		})
	).body as IDataObject;
	if (typeof token.flow_token !== 'string' || !token.flow_token) {
		throw new NodeOperationError(ctx.getNode(), 'Synergy Connect did not return a flow token.', { itemIndex: i });
	}

	const parameters: IDataObject = {
		flow_message_version: '3',
		flow_token: token.flow_token,
		flow_id: flowId,
		flow_cta: ctx.getNodeParameter('flowCta', i) as string,
		flow_action: 'navigate',
	};
	const screen = String(ctx.getNodeParameter('flowScreen', i, '') ?? '').trim();
	if (screen) {
		const data = jsonObject(ctx, i, 'flowScreenData', 'Screen Data');
		parameters.flow_action_payload = { screen, ...(data ? { data } : {}) };
	}
	const interactive: IDataObject = {
		type: 'flow',
		body: { text: ctx.getNodeParameter('flowBody', i) as string },
		action: { name: 'flow', parameters },
	};
	const footer = ctx.getNodeParameter('flowFooter', i, '') as string;
	if (footer) interactive.footer = { text: footer };

	const sent = await postMessage(ctx, i, phoneNumberId, {
		messaging_product: 'whatsapp',
		to,
		type: 'interactive',
		interactive,
	});
	return { ...sent, flow_id: flowId, flow_token_expires_at: token.expires_at ?? null };
}
