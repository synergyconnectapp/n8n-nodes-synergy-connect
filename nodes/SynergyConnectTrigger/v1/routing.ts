import type { IDataObject, INodeExecutionData } from 'n8n-workflow';
import { messageSubtype, outputIndex, outputLabels, type OutputMode } from './outputs';

export interface Delivery {
	deliveryId: string | null;
	timestamped: boolean;
	instanceId: string | null;
}

export interface RoutingConfig {
	// the selected events, Advanced ones included: they are the `fields` of the webhook
	events: string[];
	mode: OutputMode;
	// the Message Status filter; empty = every status
	statuses: string[];
}

export type RoutingResult =
	| { kind: 'ping' }
	| { kind: 'instagram' }
	| { kind: 'items'; workflowData?: INodeExecutionData[][] };

const asArray = (value: unknown): IDataObject[] =>
	Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as IDataObject[]) : [];

const isObject = (value: unknown): value is IDataObject =>
	!!value && typeof value === 'object' && !Array.isArray(value);

// The elements of one `changes[].value` that become items.
function elementsOf(field: string, value: IDataObject): IDataObject[] {
	if (field === 'smb_message_echoes' && Array.isArray(value.message_echoes)) return asArray(value.message_echoes);
	if (field === 'synergy_conversations' && Array.isArray(value.conversations)) return asArray(value.conversations);
	if (field === 'calls' && Array.isArray(value.calls)) return asArray(value.calls);
	return [value];
}

// devtools.md §6.4 steps 4 to 6, on an envelope that has ALREADY been verified.
export function routeEnvelope(body: unknown, config: RoutingConfig, delivery: Delivery): RoutingResult {
	const envelope = isObject(body) ? body : {};
	const entries = asArray(envelope.entry);
	const changes = entries.flatMap((e) => asArray(e.changes));

	// 4. a ping never runs the workflow (only when EVERY change is a ping)
	if (changes.length > 0 && changes.every((c) => c.field === 'synergy_ping')) return { kind: 'ping' };

	// 5. an Instagram envelope can reach a webhook of "all numbers": not an event of this node (§2.12)
	if (envelope.object === 'instagram') return { kind: 'instagram' };

	// 6. scan entry[].changes[]
	const count = outputLabels(config.events, config.mode).length;
	const workflowData: INodeExecutionData[][] = Array.from({ length: count }, () => []);
	let matched = false;

	const push = (eventType: string, item: IDataObject, subtype?: ReturnType<typeof messageSubtype>) => {
		const index = outputIndex(config.events, config.mode, eventType, subtype);
		if (index < 0 || index >= count) return;
		workflowData[index].push({ json: item });
		matched = true;
	};

	for (const entry of entries) {
		const wabaId = typeof entry.id === 'string' ? entry.id : null;
		const base = (eventType: string): IDataObject => ({
			_deliveryId: delivery.deliveryId,
			_timestamped: delivery.timestamped,
			_eventType: eventType,
			_instanceId: delivery.instanceId,
			_wabaId: wabaId,
		});

		for (const change of asArray(entry.changes)) {
			const field = typeof change.field === 'string' ? change.field : '';
			const value = isObject(change.value) ? change.value : {};

			if (field === 'messages') {
				const metadata = value.metadata ?? null;
				const contacts = asArray(value.contacts);
				if (config.events.includes('messages')) {
					for (const message of asArray(value.messages)) {
						const type = typeof message.type === 'string' ? message.type : 'unsupported';
						push(
							'messages',
							{
								...message,
								_metadata: metadata,
								_contact: contacts[0] ?? null,
								_messageType: type,
								...base('messages'),
							},
							messageSubtype(message),
						);
					}
				}
				if (config.events.includes('statuses')) {
					for (const status of asArray(value.statuses)) {
						if (config.statuses.length > 0 && !config.statuses.includes(String(status.status))) continue;
						push('statuses', { ...status, _metadata: metadata, ...base('statuses') });
					}
				}
				continue;
			}

			if (!field || !config.events.includes(field)) continue;
			const metadata = value.metadata ?? null;
			for (const element of elementsOf(field, value)) {
				push(field, { ...element, ...(metadata ? { _metadata: metadata } : {}), ...base(field) });
			}
		}
	}

	return matched ? { kind: 'items', workflowData } : { kind: 'items' };
}
