import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { apiRequest, pathPart } from '../transport';
import { buildUploadForm } from './media';
import type { Getter } from './message';

// "Components (JSON)" wins; otherwise the structured fields make the Meta components.
export function buildTemplateComponents(get: Getter, fail: (message: string) => Error): IDataObject[] {
	const json = get('tplComponents', '');
	if (typeof json === 'string' ? json.trim() !== '' : Array.isArray(json)) {
		let parsed: unknown = json;
		if (typeof json === 'string') {
			try {
				parsed = JSON.parse(json);
			} catch {
				throw fail('Components is not valid JSON');
			}
		}
		if (!Array.isArray(parsed)) throw fail('Components must be a JSON array');
		return parsed as IDataObject[];
	}

	const components: IDataObject[] = [];
	const header = String(get('tplHeader', '') ?? '');
	if (header) components.push({ type: 'HEADER', format: 'TEXT', text: header });

	const bodyText = String(get('tplBody', '') ?? '');
	if (!bodyText) throw fail('Body Text is required (or fill Components (JSON))');
	const body: IDataObject = { type: 'BODY', text: bodyText };
	const examples = String(get('tplBodyExamples', '') ?? '')
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);
	if (examples.length > 0) body.example = { body_text: [examples] };
	components.push(body);

	const footer = String(get('tplFooter', '') ?? '');
	if (footer) components.push({ type: 'FOOTER', text: footer });

	const buttons = ((get('tplButtons', {}) as IDataObject).buttonValues as IDataObject[]) ?? [];
	if (buttons.length > 0) {
		components.push({
			type: 'BUTTONS',
			buttons: buttons.map((b) => ({
				type: b.type,
				text: b.text,
				...(b.type === 'URL' && b.url ? { url: b.url } : {}),
				...(b.type === 'PHONE_NUMBER' && b.phone_number ? { phone_number: b.phone_number } : {}),
			})),
		});
	}
	return components;
}

const SIMPLE_KEYS = ['id', 'name', 'language', 'status', 'category'] as const;

export function simplifyTemplate(template: IDataObject): IDataObject {
	const out: IDataObject = {};
	for (const key of SIMPLE_KEYS) out[key] = template[key] as string;
	return out;
}

export async function handleTemplate(
	ctx: IExecuteFunctions,
	i: number,
	phoneNumberId: string,
	operation: string,
): Promise<IDataObject | IDataObject[]> {
	const base = `/v1/numbers/${pathPart(phoneNumberId)}/templates`;
	const fail = (message: string) => new NodeOperationError(ctx.getNode(), message, { itemIndex: i });
	const get: Getter = (name, fallback) => ctx.getNodeParameter(name, i, fallback);

	switch (operation) {
		case 'getAll': {
			const filters = ctx.getNodeParameter('filters', i, {}) as IDataObject;
			const returnAll = ctx.getNodeParameter('returnAll', i) as boolean;
			const limit = returnAll ? 100 : (ctx.getNodeParameter('limit', i) as number);
			const qs: IDataObject = { limit: Math.min(Math.max(limit, 1), 100) };
			if (filters.status) qs.status = filters.status as string;
			if (filters.name) qs.name = filters.name as string;
			if (filters.language) qs.language = filters.language as string;
			const response = await apiRequest(ctx, {
				method: 'GET',
				path: base,
				qs,
				scope: 'messages',
				itemIndex: i,
			});
			const data = ((response.body as IDataObject).data as IDataObject[]) ?? [];
			return ctx.getNodeParameter('simplify', i, true) ? data.map(simplifyTemplate) : data;
		}
		case 'get': {
			const id = pathPart(ctx.getNodeParameter('templateId', i) as string);
			const response = await apiRequest(ctx, {
				method: 'GET',
				path: `${base}/${id}`,
				scope: 'messages',
				itemIndex: i,
			});
			return response.body as IDataObject;
		}
		case 'create': {
			const body: IDataObject = {
				name: ctx.getNodeParameter('tplName', i) as string,
				language: ctx.getNodeParameter('tplLanguage', i) as string,
				category: ctx.getNodeParameter('tplCategory', i) as string,
				components: buildTemplateComponents(get, fail),
			};
			const response = await apiRequest(ctx, {
				method: 'POST',
				path: base,
				scope: 'management',
				body,
				itemIndex: i,
			});
			return response.body as IDataObject;
		}
		case 'update': {
			const id = pathPart(ctx.getNodeParameter('templateId', i) as string);
			const body: IDataObject = { components: buildTemplateComponents(get, fail) };
			const category = ctx.getNodeParameter('tplUpdateCategory', i, '') as string;
			if (category) body.category = category;
			const response = await apiRequest(ctx, {
				method: 'POST',
				path: `${base}/${id}`,
				scope: 'management',
				body,
				itemIndex: i,
			});
			return response.body as IDataObject;
		}
		case 'delete': {
			const id = pathPart(ctx.getNodeParameter('templateId', i) as string);
			await apiRequest(ctx, {
				method: 'DELETE',
				path: `${base}/${id}`,
				scope: 'management',
				itemIndex: i,
			});
			return { deleted: true };
		}
		case 'uploadExample': {
			const form = await buildUploadForm(ctx, i, false);
			const response = await apiRequest(ctx, {
				method: 'POST',
				path: `${base}/media`,
				scope: 'management',
				body: form,
				itemIndex: i,
			});
			return response.body as IDataObject;
		}
		default:
			throw fail(`Unknown template operation: ${operation}`);
	}
}
