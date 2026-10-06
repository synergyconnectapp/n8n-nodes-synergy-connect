import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest, pathPart } from '../transport';

export const HANDOFF_PLAN_MESSAGE =
	'Hand Off needs a plan with the inbox (not available on the Developer plan)';

export async function handleConversation(
	ctx: IExecuteFunctions,
	i: number,
	phoneNumberId: string,
	operation: string,
): Promise<IDataObject> {
	if (operation !== 'handOff') {
		throw new NodeOperationError(ctx.getNode(), `Unknown conversation operation: ${operation}`, {
			itemIndex: i,
		});
	}
	const response = await apiRequest(ctx, {
		method: 'POST',
		path: `/v1/numbers/${pathPart(phoneNumberId)}/handoff`,
		scope: 'messages',
		body: { wa_id: ctx.getNodeParameter('waId', i) as string },
		itemIndex: i,
		hints: { planMessage: HANDOFF_PLAN_MESSAGE },
	});
	return response.body as IDataObject;
}
