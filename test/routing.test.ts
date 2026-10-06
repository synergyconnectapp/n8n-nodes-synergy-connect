import { describe, expect, it } from 'vitest';
import {
	EVENT_LABELS,
	MESSAGE_SUBTYPES,
	messageSubtype,
	outputIndex,
	outputLabels,
	outputsExpression,
} from '../nodes/SynergyConnectTrigger/v1/outputs';
import { routeEnvelope, type RoutingConfig } from '../nodes/SynergyConnectTrigger/v1/routing';
import { messageChange, statusChange, textMessage } from './helpers';

const delivery = { deliveryId: 'ev-1:abcd1234', timestamped: true, instanceId: 'a'.repeat(64) };
const envelopeOf = (...changes: unknown[]) => ({
	object: 'whatsapp_business_account',
	entry: [{ id: '1029384756', time: 1, changes }],
});

const subtypeConfig: RoutingConfig = {
	events: ['messages', 'statuses', 'message_template_status_update'],
	mode: 'perMessageSubtype',
	statuses: [],
};

function branches(config: RoutingConfig, body: unknown) {
	const result = routeEnvelope(body, config, delivery);
	if (result.kind !== 'items' || !result.workflowData) return null;
	const labels = outputLabels(config.events, config.mode);
	return Object.fromEntries(labels.map((l, i) => [l, result.workflowData?.[i].length ?? 0]));
}

describe('output routing', () => {
	it('single: one output with everything', () => {
		const config: RoutingConfig = { events: ['messages', 'statuses'], mode: 'single', statuses: [] };
		const result = routeEnvelope(
			envelopeOf(messageChange(textMessage), statusChange('read')),
			config,
			delivery,
		);
		expect(result.kind === 'items' && result.workflowData?.length).toBe(1);
		expect(result.kind === 'items' && result.workflowData?.[0].length).toBe(2);
	});

	it('perEventType: messages and statuses of the same Meta field go to their own output', () => {
		const config: RoutingConfig = { events: ['messages', 'statuses'], mode: 'perEventType', statuses: [] };
		expect(outputLabels(config.events, config.mode)).toEqual(['Message Received', 'Message Status']);
		expect(branches(config, envelopeOf(messageChange(textMessage), statusChange('delivered')))).toEqual({
			'Message Received': 1,
			'Message Status': 1,
		});
	});

	it('perMessageSubtype: each type lands on its subtype output, Flow Response included', () => {
		const message = (m: object) => ({ id: 'wamid.X', from: '5511988887777', ...m });
		const cases: [object, string][] = [
			[{ type: 'text', text: { body: 'a' } }, 'Text'],
			[{ type: 'image', image: { id: '1' } }, 'Image'],
			[{ type: 'button', button: { text: 'Yes', payload: 'y' } }, 'Button Reply'],
			[{ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b' } } }, 'Button Reply'],
			[{ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'l' } } }, 'List Reply'],
			[{ type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow' } } }, 'Flow Response'],
			[{ type: 'reaction', reaction: { emoji: '👍' } }, 'Reaction'],
			[{ type: 'order', order: {} }, 'Order'],
			[{ type: 'unsupported' }, 'Other Messages'],
			[{ type: 'something_new' }, 'Other Messages'],
		];
		for (const [payload, label] of cases) {
			const counts = branches(subtypeConfig, envelopeOf(messageChange(message(payload))));
			expect(counts?.[label], label).toBe(1);
			expect(Object.values(counts ?? {}).reduce((a, b) => a + b, 0), label).toBe(1);
		}
	});

	it('perMessageSubtype: statuses and other events keep one output each', () => {
		const counts = branches(
			subtypeConfig,
			envelopeOf(
				statusChange('failed'),
				{ field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: 9 } },
			),
		);
		expect(counts?.['Message Status']).toBe(1);
		expect(counts?.['Template Status']).toBe(1);
	});

	it('every item carries the delivery metadata, and nothing from the payload can override it', () => {
		const result = routeEnvelope(
			envelopeOf(messageChange({ ...textMessage, _eventType: 'forged', _deliveryId: 'forged' })),
			{ events: ['messages'], mode: 'single', statuses: [] },
			delivery,
		);
		const item = result.kind === 'items' ? result.workflowData?.[0][0].json : undefined;
		expect(item).toMatchObject({
			id: 'wamid.T',
			_deliveryId: 'ev-1:abcd1234',
			_timestamped: true,
			_eventType: 'messages',
			_instanceId: 'a'.repeat(64),
			_wabaId: '1029384756',
			_messageType: 'text',
		});
	});

	it('the status filter keeps only the chosen statuses', () => {
		const config: RoutingConfig = { events: ['statuses'], mode: 'single', statuses: ['read'] };
		expect(routeEnvelope(envelopeOf(statusChange('sent')), config, delivery)).toEqual({ kind: 'items' });
		const read = routeEnvelope(envelopeOf(statusChange('read')), config, delivery);
		expect(read.kind === 'items' && read.workflowData?.[0].length).toBe(1);
	});

	it('an event that was not chosen, or an empty envelope, produces no workflowData', () => {
		const config: RoutingConfig = { events: ['messages'], mode: 'single', statuses: [] };
		expect(routeEnvelope(envelopeOf(statusChange('read')), config, delivery)).toEqual({ kind: 'items' });
		expect(routeEnvelope({ entry: [] }, config, delivery)).toEqual({ kind: 'items' });
		expect(routeEnvelope('not an envelope', config, delivery)).toEqual({ kind: 'items' });
		expect(
			routeEnvelope(envelopeOf({ field: 'account_update', value: {} }), config, delivery),
		).toEqual({ kind: 'items' });
	});

	it('echo, conversation and group events become one item per element', () => {
		const config: RoutingConfig = {
			events: ['smb_message_echoes', 'synergy_conversations', 'group_lifecycle_update'],
			mode: 'perEventType',
			statuses: [],
		};
		const counts = branches(
			config,
			envelopeOf(
				{ field: 'smb_message_echoes', value: { message_echoes: [{ id: 'a' }, { id: 'b' }] } },
				{ field: 'synergy_conversations', value: { conversations: [{ wa_id: '1', status: 'open' }] } },
				{ field: 'group_lifecycle_update', value: { group_id: 'g' } },
			),
		);
		expect(counts).toEqual({ 'Message Echo': 2, 'Conversation Status': 1, 'Group Lifecycle': 1 });
	});

	it('the subtype of a message has a branch in the list of subtypes', () => {
		expect(messageSubtype({ type: 'text' })).toBe('Text');
		for (const subtype of MESSAGE_SUBTYPES) {
			expect(outputLabels(['messages'], 'perMessageSubtype')).toContain(subtype);
		}
		expect(outputIndex(['messages'], 'perMessageSubtype', 'messages', 'Flow Response')).toBe(
			MESSAGE_SUBTYPES.indexOf('Flow Response'),
		);
		expect(outputIndex(['messages'], 'perEventType', 'statuses')).toBe(-1);
	});
});

describe('the `outputs` expression of the node', () => {
	// n8n evaluates this string in the editor. It is generated from the same lists as outputLabels, so the two cannot
	// drift: the lists are embedded as they are.
	const expression = outputsExpression();

	it('embeds the subtypes and the labels of the code', () => {
		expect(expression.startsWith('={{')).toBe(true);
		expect(expression).toContain(JSON.stringify(MESSAGE_SUBTYPES));
		expect(expression).toContain(JSON.stringify(EVENT_LABELS));
		expect(expression).toContain('perMessageSubtype');
		expect(expression).toContain('$parameter["advancedEvents"]');
	});

	it('labels every event of the node, Onboarding Result included', () => {
		expect(EVENT_LABELS.synergy_onboarding).toBe('Onboarding Result');
		expect(outputLabels(['synergy_onboarding'], 'perEventType')).toEqual(['Onboarding Result']);
		expect(outputLabels(['messages', 'calls'], 'perEventType')).toEqual(['Message Received', 'Calls']);
		expect(outputLabels(['messages', 'calls'], 'single')).toEqual(['All Events']);
	});
});
