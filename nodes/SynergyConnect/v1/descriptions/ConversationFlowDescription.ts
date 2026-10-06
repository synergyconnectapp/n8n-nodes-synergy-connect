import type { INodeProperties } from 'n8n-workflow';
import { showFor } from './common';

export const conversationOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor('conversation'),
		options: [
			{
				name: 'Hand Off to Agent',
				value: 'handOff',
				action: 'Hand off a conversation to an agent',
				description: 'Move the conversation to the queue of the human agents',
			},
		],
		default: 'handOff',
	},
];

export const conversationFields: INodeProperties[] = [
	{
		displayName: 'Customer Phone Number',
		name: 'waId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '5511999999999',
		description: 'The customer of the conversation, with country code and no + sign',
		displayOptions: showFor('conversation', ['handOff']),
	},
];

export const flowOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor('flow'),
		options: [
			{
				name: 'Send Flow',
				value: 'sendFlow',
				action: 'Issue the token and send a flow',
				description: 'Issue the flow token and send the WhatsApp Flow in one step',
			},
		],
		default: 'sendFlow',
	},
];

export const flowFields: INodeProperties[] = [
	{
		displayName: 'Recipient Phone Number',
		name: 'to',
		type: 'string',
		required: true,
		default: '',
		placeholder: '5511999999999',
		description: 'The customer who receives the flow, with country code and no + sign',
		displayOptions: showFor('flow', ['sendFlow']),
	},
	{
		displayName: 'Flow ID',
		name: 'flowId',
		type: 'string',
		required: true,
		default: '',
		placeholder: '1234567890',
		description: 'ID of the flow (5 to 25 digits)',
		displayOptions: showFor('flow', ['sendFlow']),
	},
	{
		displayName: 'Message Text',
		name: 'flowBody',
		type: 'string',
		typeOptions: { rows: 3 },
		required: true,
		default: '',
		description: 'Text shown above the flow button',
		displayOptions: showFor('flow', ['sendFlow']),
	},
	{
		displayName: 'Button Text',
		name: 'flowCta',
		type: 'string',
		required: true,
		default: 'Open',
		description: 'Text of the button that opens the flow (max 30 characters)',
		displayOptions: showFor('flow', ['sendFlow']),
	},
	{
		displayName: 'Footer Text',
		name: 'flowFooter',
		type: 'string',
		default: '',
		displayOptions: showFor('flow', ['sendFlow']),
	},
	{
		displayName: 'First Screen ID',
		name: 'flowScreen',
		type: 'string',
		default: '',
		description: 'Screen the flow opens on. Leave empty to open the first one.',
		displayOptions: showFor('flow', ['sendFlow']),
	},
	{
		displayName: 'Screen Data (JSON)',
		name: 'flowScreenData',
		type: 'json',
		default: '',
		description: 'Data for the first screen, as a JSON object',
		displayOptions: showFor('flow', ['sendFlow']),
	},
	{
		displayName: 'Token Context (JSON)',
		name: 'flowContext',
		type: 'json',
		default: '',
		description:
			'Text values that the flow endpoint receives with the token, as a JSON object. The flow type decides which keys are valid.',
		displayOptions: showFor('flow', ['sendFlow']),
	},
];
