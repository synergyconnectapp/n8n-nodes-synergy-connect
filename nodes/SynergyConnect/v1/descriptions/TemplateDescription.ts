import type { INodeProperties } from 'n8n-workflow';
import { showFor } from './common';

export const templateOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor('template'),
		options: [
			{ name: 'Create', value: 'create', action: 'Create a template', description: 'Create a message template (needs the management scope)' },
			{ name: 'Delete', value: 'delete', action: 'Delete a template', description: 'Delete a template by ID (needs the management scope)' },
			{ name: 'Get', value: 'get', action: 'Get a template', description: 'Get a template by ID' },
			{ name: 'Get Many', value: 'getAll', action: 'Get many templates', description: 'List the templates of the number' },
			{ name: 'Update', value: 'update', action: 'Update a template', description: 'Update the components of a template (needs the management scope)' },
			{ name: 'Upload Example Media', value: 'uploadExample', action: 'Upload example media for a template', description: 'Upload the sample file of a media header and get its handle' },
		],
		default: 'getAll',
	},
];

const STRUCTURED = ['create', 'update'];

export const templateFields: INodeProperties[] = [
	// ── Get Many ──
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: showFor('template', ['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['template'], operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return only ID, name, language, status and category',
		displayOptions: showFor('template', ['getAll']),
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: showFor('template', ['getAll']),
		options: [
			{
				displayName: 'Language',
				name: 'language',
				type: 'string',
				default: '',
				placeholder: 'pt_BR',
				description: 'Exact language of the template',
			},
			{
				displayName: 'Name Starts With',
				name: 'name',
				type: 'string',
				default: '',
				description: 'Prefix of the template name. No wildcards.',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Approved', value: 'APPROVED' },
					{ name: 'Disabled', value: 'DISABLED' },
					{ name: 'Paused', value: 'PAUSED' },
					{ name: 'Pending', value: 'PENDING' },
					{ name: 'Rejected', value: 'REJECTED' },
				],
				default: 'APPROVED',
				description: 'Status of the template at Meta. The default is Approved.',
			},
		],
	},

	// ── Get / Update / Delete ──
	{
		displayName: 'Template ID',
		name: 'templateId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the template',
		displayOptions: showFor('template', ['get', 'update', 'delete']),
	},

	// ── Create / Update ──
	{
		displayName: 'Name',
		name: 'tplName',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'order_update',
		description: 'Lowercase letters, digits and underscores',
		displayOptions: showFor('template', ['create']),
	},
	{
		displayName: 'Language',
		name: 'tplLanguage',
		type: 'string',
		required: true,
		default: 'pt_BR',
		displayOptions: showFor('template', ['create']),
	},
	{
		displayName: 'Category',
		name: 'tplCategory',
		type: 'options',
		options: [
			{ name: 'Authentication', value: 'AUTHENTICATION' },
			{ name: 'Marketing', value: 'MARKETING' },
			{ name: 'Utility', value: 'UTILITY' },
		],
		required: true,
		default: 'UTILITY',
		displayOptions: showFor('template', ['create']),
	},
	{
		displayName: 'Header Text',
		name: 'tplHeader',
		type: 'string',
		default: '',
		description: 'Optional text header',
		displayOptions: showFor('template', STRUCTURED),
	},
	{
		displayName: 'Body Text',
		name: 'tplBody',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		placeholder: 'Hello {{1}}, your order {{2}} is on its way.',
		description: 'Body of the template. Use {{1}}, {{2}}… for variables.',
		displayOptions: showFor('template', STRUCTURED),
	},
	{
		displayName: 'Body Examples',
		name: 'tplBodyExamples',
		type: 'string',
		default: '',
		placeholder: 'Maria, 12345',
		description: 'Comma-separated sample values for the body variables, in order. Meta requires them when the body has variables.',
		displayOptions: showFor('template', STRUCTURED),
	},
	{
		displayName: 'Footer Text',
		name: 'tplFooter',
		type: 'string',
		default: '',
		displayOptions: showFor('template', STRUCTURED),
	},
	{
		displayName: 'Buttons',
		name: 'tplButtons',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Button',
		displayOptions: showFor('template', STRUCTURED),
		options: [
			{
				name: 'buttonValues',
				displayName: 'Button',
				values: [
					{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						options: [
							{ name: 'Phone Number', value: 'PHONE_NUMBER' },
							{ name: 'Quick Reply', value: 'QUICK_REPLY' },
							{ name: 'URL', value: 'URL' },
						],
						default: 'QUICK_REPLY',
					},
					{ displayName: 'Text', name: 'text', type: 'string', required: true, default: '' },
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						default: '',
						description: 'For URL buttons',
					},
					{
						displayName: 'Phone Number',
						name: 'phone_number',
						type: 'string',
						default: '',
						description: 'For phone number buttons, with country code',
					},
				],
			},
		],
	},
	{
		displayName: 'Components (JSON)',
		name: 'tplComponents',
		type: 'json',
		default: '',
		description:
			'JSON array of components in the Meta format. When filled, it replaces the header, body, footer and buttons above.',
		displayOptions: showFor('template', STRUCTURED),
	},
	{
		displayName: 'Category',
		name: 'tplUpdateCategory',
		type: 'options',
		options: [
			{ name: 'Keep Current', value: '' },
			{ name: 'Marketing', value: 'MARKETING' },
			{ name: 'Utility', value: 'UTILITY' },
		],
		default: '',
		description: 'Change the category of the template',
		displayOptions: showFor('template', ['update']),
	},

	// ── Upload Example Media ──
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the sample file (JPEG, PNG, MP4 or PDF, up to 5 MB)',
		displayOptions: showFor('template', ['uploadExample']),
	},
	{
		displayName: 'MIME Type',
		name: 'mimeType',
		type: 'string',
		default: '',
		placeholder: 'image/jpeg',
		description: 'MIME type of the file. Leave empty to use the one of the binary data.',
		displayOptions: showFor('template', ['uploadExample']),
	},
];
