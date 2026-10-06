import type { IBinaryKeyData, IDataObject } from 'n8n-workflow';

// An action that returns a file: the item carries `binary` next to its `json`.
export class WithBinary {
	constructor(
		readonly json: IDataObject,
		readonly binary: IBinaryKeyData,
	) {}
}

export type ActionResult = IDataObject | WithBinary;
