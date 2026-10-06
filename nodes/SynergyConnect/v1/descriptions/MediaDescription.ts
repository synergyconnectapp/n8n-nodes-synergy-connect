import type { INodeProperties } from 'n8n-workflow';
import { showFor } from './common';

export const mediaOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: showFor('media'),
		options: [
			{ name: 'Delete', value: 'delete', action: 'Delete a media file', description: 'Delete an uploaded media file' },
			{ name: 'Download', value: 'download', action: 'Download a media file', description: 'Download the file into a binary property' },
			{ name: 'Get', value: 'get', action: 'Get a media file', description: 'Get the metadata of a media file' },
			{ name: 'Upload', value: 'upload', action: 'Upload a media file', description: 'Upload a file to use in messages' },
		],
		default: 'upload',
	},
];

export const mediaFields: INodeProperties[] = [
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		required: true,
		default: 'data',
		hint: 'The name of the input binary field containing the file to upload',
		displayOptions: showFor('media', ['upload']),
	},
	{
		displayName: 'MIME Type',
		name: 'mimeType',
		type: 'string',
		default: '',
		placeholder: 'image/jpeg',
		description: 'MIME type of the file. Leave empty to use the one of the binary data.',
		displayOptions: showFor('media', ['upload']),
	},
	{
		displayName: 'Media ID',
		name: 'mediaId',
		type: 'string',
		required: true,
		default: '',
		description: 'ID of the media file',
		displayOptions: showFor('media', ['get', 'download', 'delete']),
	},
	{
		displayName: 'Put Output in Field',
		name: 'outputBinaryField',
		type: 'string',
		default: 'data',
		hint: 'The name of the output binary field to put the file in',
		displayOptions: showFor('media', ['download']),
	},
	{
		displayName: 'Options',
		name: 'mediaOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: showFor('media'),
		options: [
			{
				displayName: 'Graph API Version',
				name: 'graphApiVersion',
				type: 'string',
				default: 'v25.0',
				description: 'Version segment of the media routes',
			},
		],
	},
];
