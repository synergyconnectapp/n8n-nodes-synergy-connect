import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	JsonObject,
	INodeTypeBaseDescription,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { phoneNumberField, resourceField } from './descriptions/common';
import { conversationFields, conversationOperations, flowFields, flowOperations } from './descriptions/ConversationFlowDescription';
import { mediaFields, mediaOperations } from './descriptions/MediaDescription';
import { messageFields, messageOperations } from './descriptions/MessageDescription';
import { templateFields, templateOperations } from './descriptions/TemplateDescription';
import { handleConversation } from './actions/conversation';
import { handleFlow } from './actions/flow';
import { handleMedia } from './actions/media';
import { handleMessage } from './actions/message';
import { WithBinary, type ActionResult } from './actions/result';
import { handleTemplate } from './actions/template';
import { getTemplates, searchNumbers } from './methods';
import { resolveBaseUrl, resolvePhoneNumberId } from './transport';

const versionDescription: Omit<INodeTypeDescription, 'displayName' | 'name' | 'icon' | 'group' | 'defaultVersion'> = {
	version: 1,
	subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
	description: 'Send WhatsApp messages and manage media, templates and flows with Synergy Connect',
	defaults: { name: 'Synergy Connect' },
	inputs: [NodeConnectionTypes.Main],
	outputs: [NodeConnectionTypes.Main],
	usableAsTool: true,
	credentials: [{ name: 'synergyConnectApi', required: true }],
	properties: [
		resourceField,
		phoneNumberField,
		...messageOperations,
		...mediaOperations,
		...templateOperations,
		...conversationOperations,
		...flowOperations,
		...messageFields,
		...mediaFields,
		...templateFields,
		...conversationFields,
		...flowFields,
	],
};

export class SynergyConnectV1 {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = { ...baseDescription, ...versionDescription };
	}

	methods = {
		listSearch: { searchNumbers },
		loadOptions: { getTemplates },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// S-46: a Base URL that is not an https origin stops here, before any request carries the key
		resolveBaseUrl(this.getNode(), await this.getCredentials('synergyConnectApi'));

		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const phoneNumberId = await resolvePhoneNumberId(this, i);

				let result: ActionResult | IDataObject[];
				if (resource === 'message') result = await handleMessage(this, i, phoneNumberId, operation);
				else if (resource === 'media') result = await handleMedia(this, i, phoneNumberId, operation);
				else if (resource === 'template') result = await handleTemplate(this, i, phoneNumberId, operation);
				else if (resource === 'conversation') result = await handleConversation(this, i, phoneNumberId, operation);
				else if (resource === 'flow') result = await handleFlow(this, i, phoneNumberId, operation);
				else throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, { itemIndex: i });

				if (result instanceof WithBinary) {
					returnData.push({ json: result.json, binary: result.binary, pairedItem: { item: i } });
				} else {
					returnData.push(
						...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(result), {
							itemData: { item: i },
						}),
					);
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push(
						...this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray({ error: (error as Error).message }),
							{ itemData: { item: i } },
						),
					);
					continue;
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}
		return [returnData];
	}
}
