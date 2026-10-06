import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { DEFAULT_GRAPH_VERSION, apiRequest, pathPart } from '../transport';
import { WithBinary, type ActionResult } from './result';

function graphVersion(ctx: IExecuteFunctions, i: number): string {
	const options = ctx.getNodeParameter('mediaOptions', i, {}) as IDataObject;
	const version = String(options.graphApiVersion || DEFAULT_GRAPH_VERSION);
	if (!/^v\d+\.\d+$/.test(version)) {
		throw new NodeOperationError(ctx.getNode(), 'Graph API Version must look like v25.0', { itemIndex: i });
	}
	return version;
}

// The form of an upload (media of a message, or the sample of a template header). The Content-Type with the boundary
// is left to the HTTP layer.
export async function buildUploadForm(
	ctx: IExecuteFunctions,
	i: number,
	withProduct: boolean,
): Promise<FormData> {
	const field = ctx.getNodeParameter('binaryPropertyName', i) as string;
	const binary = ctx.helpers.assertBinaryData(i, field);
	const buffer = await ctx.helpers.getBinaryDataBuffer(i, field);
	const mimeType = (ctx.getNodeParameter('mimeType', i, '') as string).trim() || binary.mimeType;
	if (!mimeType) {
		throw new NodeOperationError(ctx.getNode(), 'The MIME type of the file is unknown: set MIME Type.', {
			itemIndex: i,
		});
	}
	const form = new FormData();
	if (withProduct) {
		form.append('messaging_product', 'whatsapp');
		form.append('type', mimeType);
	}
	form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), binary.fileName ?? 'file');
	return form;
}

export async function handleMedia(
	ctx: IExecuteFunctions,
	i: number,
	phoneNumberId: string,
	operation: string,
): Promise<ActionResult> {
	const version = graphVersion(ctx, i);
	const number = pathPart(phoneNumberId);

	switch (operation) {
		case 'upload': {
			const form = await buildUploadForm(ctx, i, true);
			const response = await apiRequest(ctx, {
				method: 'POST',
				path: `/${version}/${number}/media`,
				scope: 'messages',
				body: form,
				itemIndex: i,
			});
			return response.body as IDataObject;
		}
		case 'get': {
			const id = pathPart(ctx.getNodeParameter('mediaId', i) as string);
			const response = await apiRequest(ctx, {
				method: 'GET',
				path: `/${version}/${id}`,
				qs: { phone_number_id: phoneNumberId },
				scope: 'messages',
				itemIndex: i,
			});
			return response.body as IDataObject;
		}
		case 'download': {
			const mediaId = (ctx.getNodeParameter('mediaId', i) as string).trim();
			const outputField = (ctx.getNodeParameter('outputBinaryField', i, 'data') as string) || 'data';
			const response = await apiRequest(ctx, {
				method: 'GET',
				path: `/${version}/${pathPart(mediaId)}/download`,
				qs: { phone_number_id: phoneNumberId },
				scope: 'messages',
				binary: true,
				itemIndex: i,
			});
			const contentType =
				(response.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim() ||
				'application/octet-stream';
			const file = await ctx.helpers.prepareBinaryData(
				Buffer.from(response.body as ArrayBuffer),
				mediaId,
				contentType,
			);
			return new WithBinary({ id: mediaId, mime_type: contentType }, { [outputField]: file });
		}
		case 'delete': {
			const id = pathPart(ctx.getNodeParameter('mediaId', i) as string);
			await apiRequest(ctx, {
				method: 'DELETE',
				path: `/${version}/${id}`,
				qs: { phone_number_id: phoneNumberId },
				scope: 'messages',
				itemIndex: i,
			});
			return { deleted: true };
		}
		default:
			throw new NodeOperationError(ctx.getNode(), `Unknown media operation: ${operation}`, { itemIndex: i });
	}
}
