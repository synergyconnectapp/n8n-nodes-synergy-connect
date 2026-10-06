import type {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	IDataObject,
} from 'n8n-workflow';
import { apiRequest, pathPart, resolvePhoneNumberId } from './transport';

// GET /v1/numbers: the numbers the key reaches (WhatsApp only).
export async function searchNumbers(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const response = await apiRequest(this, { method: 'GET', path: '/v1/numbers', scope: 'messages' });
	const numbers = ((response.body as IDataObject).data as IDataObject[]) ?? [];
	const needle = (filter ?? '').trim().toLowerCase();
	const results = numbers
		.map((n) => {
			const label = [n.display_phone_number, n.alias ?? n.verified_name].filter(Boolean).join(' · ');
			return { name: label || String(n.phone_number_id), value: String(n.phone_number_id) };
		})
		.filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.value.includes(needle));
	return { results };
}

// The templates of the chosen number, as `name::language`.
export async function getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const phoneNumberId = await resolvePhoneNumberId(this);
	const response = await apiRequest(this, {
		method: 'GET',
		path: `/v1/numbers/${pathPart(phoneNumberId)}/templates`,
		qs: { limit: 100 },
		scope: 'messages',
	});
	const templates = ((response.body as IDataObject).data as IDataObject[]) ?? [];
	return templates.map((t) => ({
		name: `${t.name} (${t.language})`,
		value: `${t.name}::${t.language}`,
		description: `${t.category ?? ''} ${t.status ?? ''}`.trim(),
	}));
}
