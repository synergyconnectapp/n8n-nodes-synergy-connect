### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### 1.0.2

- Icon: both nodes and the credential show the Synergy Connect symbol
- Credential: the key is sent only in `Authorization: Bearer`, the one header the API reads (`x-api-key` is no longer sent); the help texts name the real menu of the app (Configurações → API e webhooks) and link to `synergyconnect.com.br/developers`
- Base URL: it must be the https address of the API with no path, query or fragment; anything else is refused before any request
- Phone Number ID is validated as the API declares it (5 to 20 digits), and so is Graph API Version (`vN.N`)
- Trigger: new event **Journey Event** (`synergy_journeys`), one item per journey event; `rotate-secret` is called without a body, as the API declares
- The codex files (`*.node.json`: category and documentation links) are now part of the build, and link to the n8n and authentication guides
- Error messages and descriptions say Synergy Connect
- New contract test (`npm run test:contract`): every HTTP call of the nodes, the events of the trigger and the signature vector are checked against the OpenAPI document of the API

#### 1.0.1

- Package metadata: author and contact

#### 1.0.0

First release of `@synergyconnectapp/n8n-nodes-synergy-connect`, the community nodes of Synergy Connect.

- **Synergy Connect** (action node): 14 message operations, Media, Template (Get Many, Get, Create, Update, Delete, Upload Example Media), Hand Off to Agent and Send Flow
- **Synergy Connect Trigger**: registers its webhook on the API (reused on restart, kept per URL), has events and outputs per event type, requires a valid `X-Synergy-Signature` (300 s, no fallback to `X-Hub-Signature-256`) before anything runs, and ignores pings and Instagram envelopes
- Credential **Synergy Connect API**: `syn_…` key, Base URL (default `https://api.synergyconnect.com.br`) and an optional default Phone Number ID; the test reads `GET /v1/me` and never sends a message. A Base URL that is not https is refused before any request
- Published with provenance from a workflow whose Actions are pinned by SHA
