import type { INodeTypeBaseDescription, IVersionedNodeType } from 'n8n-workflow';
import { VersionedNodeType } from 'n8n-workflow';
import { SynergyConnectTriggerV1 } from './v1/SynergyConnectTriggerV1.node';

// One version today (see SynergyConnect.node.ts): it registers its webhook on the API and verifies signatures.
export class SynergyConnectTrigger extends VersionedNodeType {
	constructor() {
		const baseDescription: INodeTypeBaseDescription = {
			displayName: 'Synergy Connect Trigger',
			name: 'synergyConnectTrigger',
			icon: 'file:synergyConnect.svg',
			group: ['trigger'],
			description: 'Receives WhatsApp events from Synergy Connect',
			defaultVersion: 1,
		};

		const nodeVersions: IVersionedNodeType['nodeVersions'] = {
			1: new SynergyConnectTriggerV1(baseDescription),
		};

		super(nodeVersions, baseDescription);
	}
}
