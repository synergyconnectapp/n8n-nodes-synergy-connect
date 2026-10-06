import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SynergyConnectApi implements ICredentialType {
	name = 'synergyConnectApi';
	displayName = 'Synergy Connect API';
	icon = {
		light: 'file:../nodes/SynergyConnect/synergyConnect.svg',
		dark: 'file:../nodes/SynergyConnect/synergyConnect.svg',
	} as const;
	documentationUrl = 'https://synergyconnect.com.br/developers/n8n';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'syn_your_api_key',
			description:
				'API key from Settings → Developer. The nodes need a <code>syn_…</code> key (scopes <code>messages</code> and <code>management</code>).',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.synergyconnect.com.br',
			description:
				'Base URL of the Synergy Connect API. Leave the default unless Synergy support gave you another one.',
		},
		{
			displayName: 'Phone Number ID',
			name: 'phoneNumberId',
			type: 'string',
			default: '',
			description: 'Default number, used when the node does not choose one',
		},
	];

	// Both headers are sent: `Authorization: Bearer` and `x-api-key`.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	// Read-only: it never sends a message.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				"={{($credentials.baseUrl || 'https://api.synergyconnect.com.br').trim().replace(/[/]+$/, '')}}",
			url: '/v1/me',
			method: 'GET',
		},
	};
}
