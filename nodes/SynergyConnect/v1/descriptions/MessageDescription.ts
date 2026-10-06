import type { INodeProperties } from 'n8n-workflow';
import { showFor } from './common';

const MEDIA_OPERATIONS = ['sendImage', 'sendVideo', 'sendAudio', 'sendDocument', 'sendSticker'];
const SEND_OPERATIONS = [
	'sendText',
	'sendImage',
	'sendVideo',
	'sendAudio',
	'sendDocument',
	'sendSticker',
	'sendLocation',
	'sendContacts',
	'sendTemplate',
	'sendButtons',
	'sendList',
	'sendReaction',
	'sendRaw',
];

export const messageOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor('message'),
		options: [
			{
				name: 'Mark as Read',
				value: 'markAsRead',
				action: 'Mark a message as read',
				description: 'Mark a received message as read',
			},
			{
				name: 'Send Audio',
				value: 'sendAudio',
				action: 'Send an audio message',
				description: 'Send an audio file or a voice message',
			},
			{
				name: 'Send Buttons',
				value: 'sendButtons',
				action: 'Send an interactive button message',
				description: 'Send a message with reply buttons (max 3)',
			},
			{
				name: 'Send Contacts',
				value: 'sendContacts',
				action: 'Send contacts',
				description: 'Send one or more contact cards',
			},
			{
				name: 'Send Document',
				value: 'sendDocument',
				action: 'Send a document',
				description: 'Send a document by URL or media ID',
			},
			{
				name: 'Send Image',
				value: 'sendImage',
				action: 'Send an image message',
				description: 'Send an image by URL or media ID',
			},
			{
				name: 'Send List',
				value: 'sendList',
				action: 'Send an interactive list message',
				description: 'Send a message with a selectable list',
			},
			{
				name: 'Send Location',
				value: 'sendLocation',
				action: 'Send a location',
				description: 'Send a geographic location',
			},
			{
				name: 'Send Raw (JSON)',
				value: 'sendRaw',
				action: 'Send a raw message body',
				description: 'Send any message body of the Cloud API as JSON',
			},
			{
				name: 'Send Reaction',
				value: 'sendReaction',
				action: 'Send a reaction',
				description: 'React to a message with an emoji',
			},
			{
				name: 'Send Sticker',
				value: 'sendSticker',
				action: 'Send a sticker',
				description: 'Send a sticker by URL or media ID',
			},
			{
				name: 'Send Template',
				value: 'sendTemplate',
				action: 'Send a template message',
				description: 'Send an approved message template',
			},
			{
				name: 'Send Text',
				value: 'sendText',
				action: 'Send a text message',
				description: 'Send a text message',
			},
			{
				name: 'Send Video',
				value: 'sendVideo',
				action: 'Send a video message',
				description: 'Send a video by URL or media ID',
			},
		],
		default: 'sendText',
	},
];

const sendTo = SEND_OPERATIONS.filter((o) => o !== 'sendRaw');

export const messageFields: INodeProperties[] = [
	{
		displayName: 'Recipient Phone Number',
		name: 'to',
		type: 'string',
		required: true,
		default: '',
		placeholder: '5511999999999',
		description: 'The WhatsApp number to send to, with country code and no + sign',
		displayOptions: showFor('message', sendTo),
	},

	// ── Text ──
	{
		displayName: 'Message Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description: 'The text of the message',
		displayOptions: showFor('message', ['sendText']),
	},
	{
		displayName: 'Preview URL',
		name: 'previewUrl',
		type: 'boolean',
		default: false,
		description: 'Whether to show a link preview in the message',
		displayOptions: showFor('message', ['sendText']),
	},

	// ── Media (image, video, audio, document, sticker) ──
	{
		displayName: 'Media Source',
		name: 'mediaSource',
		type: 'options',
		options: [
			{ name: 'Media ID', value: 'id' },
			{ name: 'URL', value: 'link' },
		],
		default: 'link',
		description: 'Whether to send a public URL or a media ID from a previous upload',
		displayOptions: showFor('message', MEDIA_OPERATIONS),
	},
	{
		displayName: 'Media URL',
		name: 'mediaLink',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'https://example.com/file',
		description: 'Public https URL of the file',
		displayOptions: {
			show: { resource: ['message'], operation: MEDIA_OPERATIONS, mediaSource: ['link'] },
		},
	},
	{
		displayName: 'Media ID',
		name: 'mediaId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID returned by Media → Upload for this number',
		displayOptions: {
			show: { resource: ['message'], operation: MEDIA_OPERATIONS, mediaSource: ['id'] },
		},
	},
	{
		displayName: 'Caption',
		name: 'caption',
		type: 'string',
		default: '',
		description: 'Optional caption',
		displayOptions: showFor('message', ['sendImage', 'sendVideo', 'sendDocument']),
	},
	{
		displayName: 'Filename',
		name: 'filename',
		type: 'string',
		default: '',
		description: 'File name shown to the recipient',
		displayOptions: showFor('message', ['sendDocument']),
	},
	{
		displayName: 'Voice',
		name: 'voice',
		type: 'boolean',
		default: false,
		description: 'Whether to send the audio as a voice message',
		displayOptions: showFor('message', ['sendAudio']),
	},

	// ── Location ──
	{
		displayName: 'Latitude',
		name: 'latitude',
		type: 'string',
		required: true,
		default: '',
		placeholder: '-23.5505',
		displayOptions: showFor('message', ['sendLocation']),
	},
	{
		displayName: 'Longitude',
		name: 'longitude',
		type: 'string',
		required: true,
		default: '',
		placeholder: '-46.6333',
		displayOptions: showFor('message', ['sendLocation']),
	},
	{
		displayName: 'Location Name',
		name: 'locationName',
		type: 'string',
		default: '',
		displayOptions: showFor('message', ['sendLocation']),
	},
	{
		displayName: 'Address',
		name: 'locationAddress',
		type: 'string',
		default: '',
		displayOptions: showFor('message', ['sendLocation']),
	},

	// ── Contacts ──
	{
		displayName: 'Contacts',
		name: 'contacts',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Contact',
		displayOptions: showFor('message', ['sendContacts']),
		options: [
			{
				name: 'contactValues',
				displayName: 'Contact',
				values: [
					{
						displayName: 'First Name',
						name: 'firstName',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Full Name',
						name: 'formattedName',
						type: 'string',
							required:	true,
						default: '',
					},
					{
						displayName: 'Last Name',
						name: 'lastName',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Phone Number',
						name: 'phone',
						type: 'string',
							required:	true,
						default: '',
						placeholder: '+5511999999999',
					},
					{
						displayName: 'Phone Type',
						name: 'phoneType',
						type: 'options',
						options: [
							{
								name: 'Cell',
								value: 'CELL',
							},
							{
								name: 'Home',
								value: 'HOME',
							},
							{
								name: 'Main',
								value: 'MAIN',
							},
							{
								name: 'Work',
								value: 'WORK',
							},
						],
						default: 'CELL',
					},
			],
			},
		],
	},

	// ── Template ──
	{
		displayName: 'Template Name or ID',
		name: 'template',
		type: 'options',
		required: true,
		default: '',
		description:
			'The approved template of the chosen number. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		typeOptions: {
			loadOptionsMethod: 'getTemplates',
			loadOptionsDependsOn: ['phoneNumberId.value'],
		},
		displayOptions: showFor('message', ['sendTemplate']),
	},
	{
		displayName: 'Language Code',
		name: 'templateLanguage',
		type: 'string',
		default: '',
		placeholder: 'pt_BR',
		description:
			'Language of the template. Leave empty to use the language of the template chosen in the list.',
		displayOptions: showFor('message', ['sendTemplate']),
	},
	{
		displayName: 'Header Variable',
		name: 'headerVariable',
		type: 'string',
		default: '',
		description: 'Text of the header variable, when the template has one',
		displayOptions: showFor('message', ['sendTemplate']),
	},
	{
		displayName: 'Body Variables',
		name: 'bodyVariables',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Variable',
		description: 'Values for {{1}}, {{2}}… of the body, in order',
		displayOptions: showFor('message', ['sendTemplate']),
		options: [
			{
				name: 'values',
				displayName: 'Variable',
				values: [{ displayName: 'Value', name: 'value', type: 'string', default: '' }],
			},
		],
	},
	{
		displayName: 'Components (JSON)',
		name: 'templateComponents',
		type: 'json',
		default: '',
		description:
			'JSON array of components in the Meta format. When filled, it replaces the header and body variables above (use it for buttons, media headers or named variables).',
		displayOptions: showFor('message', ['sendTemplate']),
	},

	// ── Buttons ──
	{
		displayName: 'Body Text',
		name: 'buttonsBody',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor('message', ['sendButtons']),
	},
	{
		displayName: 'Header Text',
		name: 'buttonsHeader',
		type: 'string',
		default: '',
		displayOptions: showFor('message', ['sendButtons']),
	},
	{
		displayName: 'Footer Text',
		name: 'buttonsFooter',
		type: 'string',
		default: '',
		displayOptions: showFor('message', ['sendButtons']),
	},
	{
		displayName: 'Buttons',
		name: 'buttons',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, maxValue: 3 },
		default: {},
		placeholder: 'Add Button',
		description: 'Reply buttons (max 3)',
		displayOptions: showFor('message', ['sendButtons']),
		options: [
			{
				name: 'buttonValues',
				displayName: 'Button',
				values: [
					{
						displayName: 'Button ID',
						name: 'buttonId',
						type: 'string',
						required: true,
						default: '',
						description: 'Identifier returned when the customer taps the button',
					},
					{
						displayName: 'Button Title',
						name: 'buttonTitle',
						type: 'string',
						required: true,
						default: '',
						description: 'Text of the button (max 20 characters)',
					},
				],
			},
		],
	},

	// ── List ──
	{
		displayName: 'Body Text',
		name: 'listBody',
		type: 'string',
		required: true,
		default: '',
		displayOptions: showFor('message', ['sendList']),
	},
	{
		displayName: 'Button Text',
		name: 'listButton',
		type: 'string',
		required: true,
		default: 'Choose',
		description: 'Text of the button that opens the list (max 20 characters)',
		displayOptions: showFor('message', ['sendList']),
	},
	{
		displayName: 'Header Text',
		name: 'listHeader',
		type: 'string',
		default: '',
		displayOptions: showFor('message', ['sendList']),
	},
	{
		displayName: 'Footer Text',
		name: 'listFooter',
		type: 'string',
		default: '',
		displayOptions: showFor('message', ['sendList']),
	},
	{
		displayName: 'Sections',
		name: 'listSections',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Section',
		displayOptions: showFor('message', ['sendList']),
		options: [
			{
				name: 'sectionValues',
				displayName: 'Section',
				values: [
					{ displayName: 'Section Title', name: 'sectionTitle', type: 'string', default: '' },
					{
						displayName: 'Rows (JSON)',
						name: 'rows',
						type: 'json',
						required: true,
						default: '[{"id":"row_1","title":"Option 1","description":"First option"}]',
						description: 'JSON array of rows: ID, title and optional description',
					},
				],
			},
		],
	},

	// ── Reaction ──
	{
		displayName: 'Message ID',
		name: 'reactionMessageId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'wamid.xxxxxxxx',
		description: 'ID of the message to react to',
		displayOptions: showFor('message', ['sendReaction']),
	},
	{
		displayName: 'Emoji',
		name: 'reactionEmoji',
		type: 'string',
		required: true,
		default: '',
		placeholder: '👍',
		description: 'The emoji to react with. Leave empty to remove the reaction.',
		displayOptions: showFor('message', ['sendReaction']),
	},

	// ── Raw ──
	{
		displayName: 'Message Body (JSON)',
		name: 'rawBody',
		type: 'json',
		required: true,
		default: '{\n  "to": "5511999999999",\n  "type": "text",\n  "text": { "body": "Hello" }\n}',
		description: 'The body of the Cloud API messages call. messaging_product is added when missing.',
		displayOptions: showFor('message', ['sendRaw']),
	},

	// ── Mark as read ──
	{
		displayName: 'Message ID',
		name: 'readMessageId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'wamid.xxxxxxxx',
		description: 'ID of the received message to mark as read',
		displayOptions: showFor('message', ['markAsRead']),
	},

	// ── Options (shared by every send) ──
	{
		displayName: 'Options',
		name: 'messageOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor(['message', 'flow']),
		options: [
			{
				displayName: 'Graph API Version',
				name: 'graphApiVersion',
				type: 'string',
				default: 'v25.0',
				description: 'Version segment of the messages route',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '={{$execution.id}}-{{$itemIndex}}',
				description:
					'The same key within 10 minutes never sends twice. Use a different key when two nodes of the same workflow send to the same item.',
			},
			{
				displayName: 'Replies Go To',
				name: 'repliesGoTo',
				type: 'options',
				options: [
					{ name: 'Key Default', value: '' },
					{ name: 'Automation', value: 'automation' },
					{ name: 'Queue', value: 'queue' },
				],
				default: '',
				description:
					'Where the customer reply goes: the agents queue, or back to the integration. By default it follows the mode of the key.',
			},
			{
				displayName: 'Reply To Message ID',
				name: 'replyToMessageId',
				type: 'string',
				default: '',
				placeholder: 'wamid.xxxxxxxx',
				description: 'ID of the message to quote. The message is sent as a reply.',
			},
		],
	},
];
