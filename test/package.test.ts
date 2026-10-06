import { describe, expect, it } from 'vitest';
import { VersionedNodeType } from 'n8n-workflow';
import { SynergyConnectApi } from '../credentials/SynergyConnectApi.credentials';
import { SynergyConnect } from '../nodes/SynergyConnect/SynergyConnect.node';
import { SynergyConnectTrigger } from '../nodes/SynergyConnectTrigger/SynergyConnectTrigger.node';
import actionCodex from '../nodes/SynergyConnect/SynergyConnect.node.json';
import triggerCodex from '../nodes/SynergyConnectTrigger/SynergyConnectTrigger.node.json';
import pkg from '../package.json';
import lock from '../package-lock.json';
import tsconfig from '../tsconfig.json';
import actionIcon from '../nodes/SynergyConnect/synergyConnect.svg?raw';
import triggerIcon from '../nodes/SynergyConnectTrigger/synergyConnect.svg?raw';
import changelog from '../CHANGELOG.md?raw';
import publishWorkflow from '../.github/workflows/publish.yml?raw';

describe('VersionedNodeType (devtools.md §6.1)', () => {
	for (const [label, Node] of [
		['action', SynergyConnect],
		['trigger', SynergyConnectTrigger],
	] as const) {
		it(`${label}: one version (1), the default, with the synergyConnectApi credential`, () => {
			const node = new Node();
			expect(node).toBeInstanceOf(VersionedNodeType);
			expect(node.description.defaultVersion).toBe(1);
			expect(Object.keys(node.nodeVersions)).toEqual(['1']);
			expect(node.getNodeType(1).description.version).toBe(1);
			expect(node.getNodeType().description.version).toBe(1);
			expect(node.getNodeType(1).description.credentials?.[0].name).toBe('synergyConnectApi');
		});
	}

	it('the codex of both nodes points at the scoped package and says nodeVersion 1.0', () => {
		expect(actionCodex.nodeVersion).toBe('1.0');
		expect(triggerCodex.nodeVersion).toBe('1.0');
		expect(actionCodex.node).toBe('@synergyconnectapp/n8n-nodes-synergy-connect.synergyConnect');
		expect(triggerCodex.node).toBe('@synergyconnectapp/n8n-nodes-synergy-connect.synergyConnectTrigger');
	});

	it('the codex of both nodes links to the developers site of Synergy Connect', () => {
		for (const codex of [actionCodex, triggerCodex]) {
			expect(codex.categories).toEqual(['Communication']);
			expect(codex.resources.primaryDocumentation).toEqual([{ url: 'https://synergyconnect.com.br/developers/n8n' }]);
			expect(codex.resources.credentialDocumentation).toEqual([
				{ url: 'https://synergyconnect.com.br/developers/authentication' },
			]);
		}
	});

	it('the codex files are part of the build (n8n reads them next to the node in dist)', () => {
		expect(tsconfig.include).toContain('nodes/**/*.node.json');
	});

	it('has Template and Send Flow', () => {
		const v1 = new SynergyConnect().getNodeType(1).description;
		const resource = v1.properties.find((p) => p.name === 'resource');
		expect((resource?.options as { value: string }[]).map((o) => o.value)).toEqual([
			'conversation',
			'flow',
			'media',
			'message',
			'template',
		]);
		const templateOps = v1.properties.find(
			(p) => p.name === 'operation' && JSON.stringify(p.displayOptions).includes('"template"'),
		);
		expect((templateOps?.options as { value: string }[]).map((o) => o.value).sort()).toEqual(
			['create', 'delete', 'get', 'getAll', 'update', 'uploadExample'].sort(),
		);
	});

	it('the 14 message operations of the spec', () => {
		const v1 = new SynergyConnect().getNodeType(1).description;
		const ops = v1.properties.find(
			(p) => p.name === 'operation' && JSON.stringify(p.displayOptions).includes('"message"'),
		);
		expect(ops?.options).toHaveLength(14);
	});
});

describe('credential synergyConnectApi (§6.2)', () => {
	const credential = new SynergyConnectApi();

	it('keeps its name and has the three fields, the number optional', () => {
		expect(credential.name).toBe('synergyConnectApi');
		const fields = Object.fromEntries(credential.properties.map((p) => [p.name, p]));
		expect(Object.keys(fields).sort()).toEqual(['apiKey', 'baseUrl', 'phoneNumberId']);
		expect(fields.apiKey.typeOptions).toEqual({ password: true });
		expect(fields.baseUrl.default).toBe('https://api.synergyconnect.com.br');
		expect(fields.phoneNumberId.required).toBeFalsy();
	});

	it('sends the key in Authorization: Bearer and in no other header', () => {
		expect(credential.authenticate).toEqual({
			type: 'generic',
			properties: {
				headers: {
					Authorization: '=Bearer {{$credentials.apiKey}}',
				},
			},
		});
	});

	it('the help points at the developers site of Synergy Connect', () => {
		expect(credential.documentationUrl).toBe('https://synergyconnect.com.br/developers/n8n');
		const links = JSON.stringify(credential.properties).match(/https?:\/\/[^"'\\<> ]+/g) ?? [];
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) {
			expect(link).toMatch(/^https:\/\/(api\.synergyconnect\.com\.br$|synergyconnect\.com\.br\/developers)/);
		}
	});

	it('the test is a read: GET /v1/me. It never sends (E1-3)', () => {
		const request = credential.test.request as { method: string; url: string; body?: unknown };
		expect(request.method).toBe('GET');
		expect(request.body).toBeUndefined();
		expect(request.url).toBe('/v1/me');
	});
});

describe('the icon', () => {
	it('is the Synergy Connect symbol: square, the brand gradients, the same file in both nodes', () => {
		expect(triggerIcon).toBe(actionIcon);
		const [, , , width, height] = /viewBox="(\S+) (\S+) (\S+) (\S+)"/.exec(actionIcon) ?? [];
		expect(Number(width)).toBeGreaterThan(0);
		expect(width).toBe(height);
		// the palette of the brand file (green → teal → blue)
		for (const color of ['#7FD88B', '#4CB698', '#209DCC', '#1DA0D4']) expect(actionIcon).toContain(color);
		// no bitmap, no script, nothing loaded from outside
		expect(actionIcon).not.toMatch(/<image|<script|href=/);
	});

	it('the nodes and the credential use it', () => {
		expect(new SynergyConnect().description.icon).toBe('file:synergyConnect.svg');
		expect(new SynergyConnectTrigger().description.icon).toBe('file:synergyConnect.svg');
		expect(new SynergyConnectApi().icon).toEqual({
			light: 'file:../nodes/SynergyConnect/synergyConnect.svg',
			dark: 'file:../nodes/SynergyConnect/synergyConnect.svg',
		});
	});
});

describe('the package (§6.6)', () => {
	it('has the publication fields', () => {
		expect(pkg.name).toBe('@synergyconnectapp/n8n-nodes-synergy-connect');
		expect(pkg.version).toBe('1.0.2');
		expect(lock.version).toBe(pkg.version);
		expect(lock.packages[''].version).toBe(pkg.version);
		expect(changelog).toContain(`#### ${pkg.version}\n`);
		expect(pkg.author).toEqual({
			name: 'Gabriel Augusto (Synergy Connect)',
			email: 'gabriel@g2ngroup.com.br',
			url: 'https://github.com/synergyconnectapp',
		});
		expect(pkg.license).toBe('MIT');
		expect(pkg.repository).toBeTruthy();
		expect(pkg.homepage).toBeTruthy();
		expect(pkg.n8n.strict).toBe(true);
		expect(pkg).not.toHaveProperty('main');
		expect(pkg.n8n.credentials).toEqual(['dist/credentials/SynergyConnectApi.credentials.js']);
		expect(pkg).not.toHaveProperty('dependencies');
		expect(pkg.devDependencies).toHaveProperty('vitest');
		expect(pkg.devDependencies['@n8n/node-cli']).toBe('>=0.23.0');
	});

	it('publish.yml pins every Action by the SHA of a commit', () => {
		const uses = [...publishWorkflow.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
		expect(uses.length).toBeGreaterThan(0);
		for (const use of uses) expect(use).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
	});
});
