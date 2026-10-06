import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';
import { SynergyConnectV1 } from './v1/SynergyConnectV1.node';

// One version today. VersionedNodeType keeps the node type stable so a future version can sit beside this one
// (workflows pin the version they were saved with).
export class SynergyConnect extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Synergy Connect',
			name: 'synergyConnect',
			icon: 'file:synergyConnect.svg',
			group: ['transform'],
			description: 'Send WhatsApp messages and manage media, templates and flows with Synergy Connect',
			defaultVersion: 1,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new SynergyConnectV1(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
