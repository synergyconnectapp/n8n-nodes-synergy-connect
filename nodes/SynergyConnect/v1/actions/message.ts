import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { DEFAULT_GRAPH_VERSION, GRAPH_VERSION_PATTERN, apiRequest, pathPart } from '../transport';

export type Getter = (name: string, fallback?: unknown) => unknown;

const MEDIA_TYPES: Record<string, string> = {
	sendImage: 'image',
	sendVideo: 'video',
	sendAudio: 'audio',
	sendDocument: 'document',
	sendSticker: 'sticker',
};

function parseJson(value: unknown, what: string, fail: (message: string) => Error): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		throw fail(`${what} is not valid JSON`);
	}
}

// The body of POST /{v}/{pnid}/messages (the Cloud API format, passed through by Synergy).
export function buildMessageBody(
	operation: string,
	get: Getter,
	fail: (message: string) => Error,
): IDataObject {
	if (operation === 'markAsRead') {
		return { messaging_product: 'whatsapp', status: 'read', message_id: get('readMessageId') as string };
	}

	if (operation === 'sendRaw') {
		const raw = parseJson(get('rawBody'), 'Message Body', fail);
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw fail('Message Body must be a JSON object');
		}
		return { messaging_product: 'whatsapp', ...(raw as IDataObject) };
	}

	const body: IDataObject = { messaging_product: 'whatsapp', to: get('to') as string };
	const options = (get('messageOptions', {}) ?? {}) as IDataObject;
	if (options.replyToMessageId && operation !== 'sendReaction') {
		body.context = { message_id: options.replyToMessageId };
	}

	if (operation === 'sendText') {
		body.type = 'text';
		const text: IDataObject = { body: get('text') as string };
		if (get('previewUrl', false)) text.preview_url = true;
		body.text = text;
	} else if (operation in MEDIA_TYPES) {
		const type = MEDIA_TYPES[operation];
		const source = get('mediaSource', 'link') as string;
		const media: IDataObject =
			source === 'id' ? { id: get('mediaId') as string } : { link: get('mediaLink') as string };
		const caption = get('caption', '') as string;
		if (caption && ['image', 'video', 'document'].includes(type)) media.caption = caption;
		const filename = get('filename', '') as string;
		if (filename && type === 'document') media.filename = filename;
		if (type === 'audio' && get('voice', false)) media.voice = true;
		body.type = type;
		body[type] = media;
	} else if (operation === 'sendLocation') {
		const location: IDataObject = {
			latitude: get('latitude') as string,
			longitude: get('longitude') as string,
		};
		const name = get('locationName', '') as string;
		if (name) location.name = name;
		const address = get('locationAddress', '') as string;
		if (address) location.address = address;
		body.type = 'location';
		body.location = location;
	} else if (operation === 'sendContacts') {
		const contacts = ((get('contacts', {}) as IDataObject).contactValues as IDataObject[]) ?? [];
		body.type = 'contacts';
		body.contacts = contacts.map((c) => ({
			name: {
				formatted_name: c.formattedName,
				...(c.firstName ? { first_name: c.firstName } : {}),
				...(c.lastName ? { last_name: c.lastName } : {}),
			},
			phones: [{ phone: c.phone, type: c.phoneType ?? 'CELL' }],
		}));
	} else if (operation === 'sendTemplate') {
		const picked = String(get('template') ?? '');
		const [name, pickedLanguage] = picked.split('::');
		const language = String(get('templateLanguage', '') || pickedLanguage || '').trim();
		if (!name) throw fail('Choose a template');
		if (!language) throw fail('Language Code is required when the template is not picked from the list');
		const template: IDataObject = { name, language: { code: language } };

		const json = get('templateComponents', '');
		let components: unknown[] = [];
		if (typeof json === 'string' ? json.trim() !== '' : Array.isArray(json)) {
			const parsed = parseJson(json, 'Components', fail);
			if (!Array.isArray(parsed)) throw fail('Components must be a JSON array');
			components = parsed;
		} else {
			const header = String(get('headerVariable', '') ?? '');
			if (header) components.push({ type: 'header', parameters: [{ type: 'text', text: header }] });
			const variables = ((get('bodyVariables', {}) as IDataObject).values as IDataObject[]) ?? [];
			if (variables.length > 0) {
				components.push({
					type: 'body',
					parameters: variables.map((v) => ({ type: 'text', text: String(v.value ?? '') })),
				});
			}
		}
		if (components.length > 0) template.components = components;
		body.type = 'template';
		body.template = template;
	} else if (operation === 'sendButtons') {
		const interactive: IDataObject = { type: 'button', body: { text: get('buttonsBody') as string } };
		const header = get('buttonsHeader', '') as string;
		if (header) interactive.header = { type: 'text', text: header };
		const footer = get('buttonsFooter', '') as string;
		if (footer) interactive.footer = { text: footer };
		const buttons = ((get('buttons', {}) as IDataObject).buttonValues as IDataObject[]) ?? [];
		interactive.action = {
			buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.buttonId, title: b.buttonTitle } })),
		};
		body.type = 'interactive';
		body.interactive = interactive;
	} else if (operation === 'sendList') {
		const interactive: IDataObject = { type: 'list', body: { text: get('listBody') as string } };
		const header = get('listHeader', '') as string;
		if (header) interactive.header = { type: 'text', text: header };
		const footer = get('listFooter', '') as string;
		if (footer) interactive.footer = { text: footer };
		const sections = ((get('listSections', {}) as IDataObject).sectionValues as IDataObject[]) ?? [];
		interactive.action = {
			button: get('listButton') as string,
			sections: sections.map((s) => ({
				title: s.sectionTitle,
				rows: parseJson(s.rows, 'Rows', fail),
			})),
		};
		body.type = 'interactive';
		body.interactive = interactive;
	} else if (operation === 'sendReaction') {
		body.type = 'reaction';
		body.reaction = { message_id: get('reactionMessageId') as string, emoji: get('reactionEmoji') as string };
	} else {
		throw fail(`Unknown message operation: ${operation}`);
	}

	return body;
}

export function messageHeaders(
	options: IDataObject,
	defaultIdempotencyKey: string,
): Record<string, string> {
	const headers: Record<string, string> = {};
	const key = options.idempotencyKey === undefined ? defaultIdempotencyKey : String(options.idempotencyKey);
	if (key) headers['Idempotency-Key'] = key;
	if (options.repliesGoTo === 'queue' || options.repliesGoTo === 'automation') {
		headers['X-Synergy-Replies'] = options.repliesGoTo;
	}
	return headers;
}

// POST /{v}/{pnid}/messages. `body` is the final Cloud API body.
export async function postMessage(
	ctx: IExecuteFunctions,
	i: number,
	phoneNumberId: string,
	body: IDataObject,
): Promise<IDataObject> {
	const options = ctx.getNodeParameter('messageOptions', i, {}) as IDataObject;
	const version = String(options.graphApiVersion || DEFAULT_GRAPH_VERSION);
	if (!GRAPH_VERSION_PATTERN.test(version)) {
		throw new NodeOperationError(ctx.getNode(), 'Graph API Version must look like v25.0', { itemIndex: i });
	}
	const response = await apiRequest(ctx, {
		method: 'POST',
		path: `/${version}/${pathPart(phoneNumberId)}/messages`,
		scope: 'messages',
		body,
		headers: messageHeaders(options, `${ctx.getExecutionId()}-${i}`),
		itemIndex: i,
	});
	return response.body as IDataObject;
}

export async function handleMessage(
	ctx: IExecuteFunctions,
	i: number,
	phoneNumberId: string,
	operation: string,
): Promise<IDataObject> {
	const body = buildMessageBody(
		operation,
		(name, fallback) => ctx.getNodeParameter(name, i, fallback),
		(message) => new NodeOperationError(ctx.getNode(), message, { itemIndex: i }),
	);
	return await postMessage(ctx, i, phoneNumberId, body);
}
