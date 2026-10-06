// The outputs of the trigger: which branches exist for a configuration, and where an item goes.

export type OutputMode = 'single' | 'perEventType' | 'perMessageSubtype';

export const MESSAGE_SUBTYPES = [
	'Text',
	'Image',
	'Video',
	'Audio',
	'Document',
	'Sticker',
	'Location',
	'Contacts',
	'Reaction',
	'Button Reply',
	'List Reply',
	'Flow Response',
	'Order',
	'Other Messages',
] as const;
export type MessageSubtype = (typeof MESSAGE_SUBTYPES)[number];

export const EVENT_LABELS: Record<string, string> = {
	messages: 'Message Received',
	statuses: 'Message Status',
	smb_message_echoes: 'Message Echo',
	synergy_conversations: 'Conversation Status',
	message_template_status_update: 'Template Status',
	message_template_quality_update: 'Template Quality',
	template_category_update: 'Template Category',
	phone_number_quality_update: 'Phone Number Quality',
	phone_number_name_update: 'Phone Number Name',
	account_update: 'Account Update',
	account_alerts: 'Account Alerts',
	group_lifecycle_update: 'Group Lifecycle',
	group_participant_update: 'Group Participants',
	group_settings_update: 'Group Settings',
	synergy_onboarding: 'Onboarding Result',
	calls: 'Calls',
	history: 'History',
	smb_app_state_sync: 'App State Sync',
	business_capability_update: 'Business Capability',
};

// The same lists inside the `outputs` expression of the node (n8n evaluates that string in the editor).
export function outputsExpression(): string {
	return `={{((events, advanced, mode) => {
	const selected = [...(events || ["messages"]), ...(advanced || [])];
	if (mode === "single") return [{ type: "main", displayName: "All Events" }];
	const SUBTYPES = ${JSON.stringify(MESSAGE_SUBTYPES)};
	const LABELS = ${JSON.stringify(EVENT_LABELS)};
	const out = [];
	for (const e of selected) {
		if (mode === "perMessageSubtype" && e === "messages") SUBTYPES.forEach((s) => out.push({ type: "main", displayName: s }));
		else out.push({ type: "main", displayName: LABELS[e] || e });
	}
	return out;
})($parameter["events"], $parameter["advancedEvents"], $parameter["outputMode"] || "single")}}`;
}

// The ordered output labels of a configuration (what the expression above also builds).
export function outputLabels(events: string[], mode: OutputMode): string[] {
	if (mode === 'single') return ['All Events'];
	const labels: string[] = [];
	for (const e of events) {
		if (mode === 'perMessageSubtype' && e === 'messages') labels.push(...MESSAGE_SUBTYPES);
		else labels.push(EVENT_LABELS[e] ?? e);
	}
	return labels;
}

export function messageSubtype(message: Record<string, unknown>): MessageSubtype {
	const type = typeof message.type === 'string' ? message.type : '';
	switch (type) {
		case 'text':
			return 'Text';
		case 'image':
			return 'Image';
		case 'video':
			return 'Video';
		case 'audio':
			return 'Audio';
		case 'document':
			return 'Document';
		case 'sticker':
			return 'Sticker';
		case 'location':
			return 'Location';
		case 'contacts':
			return 'Contacts';
		case 'reaction':
			return 'Reaction';
		case 'order':
			return 'Order';
		case 'button':
			return 'Button Reply';
		case 'interactive': {
			const interactive = message.interactive as Record<string, unknown> | undefined;
			if (interactive?.type === 'button_reply') return 'Button Reply';
			if (interactive?.type === 'list_reply') return 'List Reply';
			if (interactive?.type === 'nfm_reply') return 'Flow Response';
			return 'Other Messages';
		}
		default:
			return 'Other Messages';
	}
}

// Where an item goes; -1 when the configuration has no branch for it.
export function outputIndex(
	events: string[],
	mode: OutputMode,
	eventType: string,
	subtype?: MessageSubtype,
): number {
	if (mode === 'single') return 0;
	const labels = outputLabels(events, mode);
	if (mode === 'perMessageSubtype' && eventType === 'messages' && subtype) {
		return labels.indexOf(subtype);
	}
	return labels.indexOf(EVENT_LABELS[eventType] ?? eventType);
}
