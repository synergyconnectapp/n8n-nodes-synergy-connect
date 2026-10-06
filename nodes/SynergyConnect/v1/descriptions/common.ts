import type { INodeProperties } from 'n8n-workflow';

export const showFor = (resource: string | string[], operation?: string[]) => ({
	show: {
		resource: Array.isArray(resource) ? resource : [resource],
		...(operation ? { operation } : {}),
	},
});

export const phoneNumberField: INodeProperties = {
	displayName: 'Phone Number',
	name: 'phoneNumberId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	description:
		'The WhatsApp number of the operation. When empty, the default Phone Number ID of the credential is used.',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'searchNumbers',
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: '102290129340398',
			validation: [
				{
					type: 'regex',
					properties: { regex: '^[0-9]{5,20}$', errorMessage: 'The ID must be only digits (5 to 20).' },
				},
			],
		},
	],
};

export const resourceField: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Conversation', value: 'conversation' },
		{ name: 'Flow', value: 'flow' },
		{ name: 'Media', value: 'media' },
		{ name: 'Message', value: 'message' },
		{ name: 'Template', value: 'template' },
	],
	default: 'message',
};
