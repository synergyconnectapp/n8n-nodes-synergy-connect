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
				'A <code>syn_…</code> key with the scopes <code>messages</code> and <code>management</code>. Create it in the Synergy Connect app: Configurações → API e webhooks → Chaves de API. See the <a href="https://synergyconnect.com.br/developers/authentication">authentication guide</a>.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.synergyconnect.com.br',
			description:
				'Address of the Synergy Connect API, https and with no path. Leave the default unless Synergy Connect support gave you another one.',
		},
		{
			displayName: 'Phone Number ID',
			name: 'phoneNumberId',
			type: 'string',
			default: '',
			placeholder: '106540352242922',
			description:
				'Default WhatsApp number of the nodes, used when a node does not choose one. It is the <code>phone_number_id</code> that <code>GET /v1/numbers</code> lists.',
		},
	];

	// The API reads the key from `Authorization: Bearer` and from nowhere else (OpenAPI securitySchemes.ApiKey).
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Read-only (`getMe`): it never sends a message.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				"={{($credentials.baseUrl || 'https://api.synergyconnect.com.br').trim().replace(/[/]+$/, '')}}",
			url: '/v1/me',
			method: 'GET',
		},
	};
}
