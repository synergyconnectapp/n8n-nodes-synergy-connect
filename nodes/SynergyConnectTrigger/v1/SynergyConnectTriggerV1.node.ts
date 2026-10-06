import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeTypeBaseDescription,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { apiRequest } from '../../SynergyConnect/v1/transport';
import { checkExists, createHook, deleteHook, readHooks } from './lifecycle';
import { outputsExpression, type OutputMode } from './outputs';
import { routeEnvelope } from './routing';
import { verifySignature } from './signature';

const OK: IWebhookResponseData = { webhookResponse: 'OK' };

const versionDescription: Omit<INodeTypeDescription, 'displayName' | 'name' | 'icon' | 'group' | 'defaultVersion'> = {
	version: 1,
	subtitle: '={{($parameter["events"] || []).join(", ")}}',
	description: 'Receives WhatsApp events from Synergy Connect',
	defaults: { name: 'Synergy Connect Trigger' },
	inputs: [],
	outputs: outputsExpression() as unknown as INodeTypeDescription['outputs'],
	credentials: [{ name: 'synergyConnectApi', required: true }],
	webhooks: [
		{
			name: 'default',
			httpMethod: 'POST',
			responseMode: 'onReceived',
			path: 'webhook',
		},
	],
	properties: [
		{
			displayName:
				'The API key of the credential needs the <b>management</b> scope to register the webhook (and <b>onboarding</b> for Onboarding Result). The webhook is created when the workflow is activated and removed when it is deactivated.',
			name: 'notice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Events',
			name: 'events',
			type: 'multiOptions',
			required: true,
			default: ['messages'],
			description: 'The events to listen for. They are registered in Synergy, which only sends these.',
			options: [
				{ name: 'Account Alerts', value: 'account_alerts' },
				{ name: 'Account Update', value: 'account_update' },
				{ name: 'Conversation Status Changed', value: 'synergy_conversations', description: 'A person took, answered or resolved an automated conversation' },
				{ name: 'Group Lifecycle', value: 'group_lifecycle_update' },
				{ name: 'Group Participants', value: 'group_participant_update' },
				{ name: 'Group Settings', value: 'group_settings_update' },
				{ name: 'Message Echo', value: 'smb_message_echoes', description: 'A message sent from the WhatsApp Business app or the inbox' },
				{ name: 'Message Received', value: 'messages', description: 'An incoming message from a customer' },
				{ name: 'Message Status Update', value: 'statuses', description: 'Sent, delivered, read or failed' },
				{ name: 'Onboarding Result', value: 'synergy_onboarding', description: 'The result of a hosted number onboarding (needs the onboarding scope)' },
				{ name: 'Phone Number Name Update', value: 'phone_number_name_update' },
				{ name: 'Phone Number Quality Update', value: 'phone_number_quality_update' },
				{ name: 'Template Category Update', value: 'template_category_update' },
				{ name: 'Template Quality Update', value: 'message_template_quality_update' },
				{ name: 'Template Status Update', value: 'message_template_status_update', description: 'Approved, rejected, paused…' },
			],
		},
		{
			displayName: 'Status Filter',
			name: 'statusFilter',
			type: 'multiOptions',
			default: [],
			description: 'Only these statuses of Message Status Update. Leave empty for all of them.',
			displayOptions: { show: { events: ['statuses'] } },
			options: [
				{ name: 'Delivered', value: 'delivered' },
				{ name: 'Failed', value: 'failed' },
				{ name: 'Read', value: 'read' },
				{ name: 'Sent', value: 'sent' },
			],
		},
		{
			displayName: 'Phone Number Names or IDs',
			name: 'phoneNumbers',
			type: 'multiOptions',
			default: [],
			description:
				'Only the events of these numbers. Leave empty for every number the key reaches. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			typeOptions: { loadOptionsMethod: 'getInstances' },
			options: [],
		},
		{
			displayName: 'Output Mode',
			name: 'outputMode',
			type: 'options',
			default: 'single',
			description: 'How to organize the output branches of the trigger',
			options: [
				{ name: 'Separate by Event Type', value: 'perEventType', description: 'One output per selected event' },
				{ name: 'Separate by Message Subtype', value: 'perMessageSubtype', description: 'One output per message subtype (text, image, flow response…) and one per other event' },
				{ name: 'Single Output', value: 'single', description: 'Every event goes through one output' },
			],
		},
		{
			displayName: 'Advanced Events',
			name: 'advancedEvents',
			type: 'multiOptions',
			default: [],
			description: 'Less common events',
			options: [
				{ name: 'App State Sync', value: 'smb_app_state_sync' },
				{ name: 'Business Capability Update', value: 'business_capability_update' },
				{ name: 'Calls', value: 'calls' },
				{ name: 'History', value: 'history' },
			],
		},
	],
};

export class SynergyConnectTriggerV1 {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = { ...baseDescription, ...versionDescription };
	}

	methods = {
		loadOptions: {
			async getInstances(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await apiRequest(this, { method: 'GET', path: '/v1/numbers', scope: 'messages' });
				const numbers = ((response.body as IDataObject).data as IDataObject[]) ?? [];
				return numbers.map((n) => ({
					name: [n.display_phone_number, n.alias ?? n.verified_name].filter(Boolean).join(' · ') || String(n.id),
					value: String(n.id),
				}));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return await checkExists(this);
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return await createHook(this);
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return await deleteHook(this);
			},
		},
	};

	// devtools.md §6.4, in this order (S-45, K-05).
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const reject = (): IWebhookResponseData => {
			res.status(401).send('Unauthorized').end();
			return { noWebhookResponse: true };
		};

		// 1. the signature is over the exact bytes: never JSON.stringify(body)
		const rawBody = (req as unknown as { rawBody?: Buffer | string }).rawBody;
		if (!rawBody || (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody))) return reject();

		const parse = (): unknown => {
			try {
				return JSON.parse(Buffer.from(rawBody).toString('utf8')) as unknown;
			} catch {
				return null;
			}
		};

		const url = this.getNodeWebhookUrl('default') as string;
		const entry = readHooks(this.getWorkflowStaticData('node'))[url];

		let timestamped = false;
		let deliveryId: string | null = null;

		if (!entry) {
			// No state for this URL: Synergy's proof ping, which arrives while create() is still running and is signed
			// with a secret n8n does not have yet. A ping-only body does nothing, so it gets a 200; anything else is
			// refused.
			const body = parse() as { entry?: { changes?: { field?: unknown }[] }[] } | null;
			const changes = (body?.entry ?? []).flatMap((e) => e?.changes ?? []);
			if (changes.length > 0 && changes.every((c) => c?.field === 'synergy_ping')) return OK;
			return reject();
		}

		// 2. no secret in the state: nothing can be verified
		if (typeof entry.secret !== 'string' || entry.secret.trim() === '') {
			this.logger.error(
				'Synergy Connect Trigger: the webhook has no secret in the workflow state, so every delivery is refused. Deactivate and activate the workflow again.',
			);
			return reject();
		}

		// 3. X-Synergy-Signature (300 s) is mandatory, no fallback to X-Hub-Signature-256; any exception is a 401
		const verified = verifySignature(rawBody, req.headers, entry.secret);
		if (!verified.ok) return reject();
		timestamped = verified.timestamped;
		deliveryId = verified.deliveryId;

		// 4 to 6: ping, Instagram envelope, scan
		const instanceHeader = req.headers['x-synergy-instance-id'];
		const result = routeEnvelope(
			parse(),
			{
				events: [
					...new Set([
						...(this.getNodeParameter('events', []) as string[]),
						...(this.getNodeParameter('advancedEvents', []) as string[]),
					]),
				],
				mode: this.getNodeParameter('outputMode', 'single') as OutputMode,
				statuses: this.getNodeParameter('statusFilter', []) as string[],
			},
			{
				deliveryId,
				timestamped,
				instanceId: typeof instanceHeader === 'string' && instanceHeader ? instanceHeader : null,
			},
		);

		if (result.kind === 'items' && result.workflowData) return { workflowData: result.workflowData };
		return OK;
	}
}
