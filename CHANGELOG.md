### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### 1.0.1

- Package metadata: author and contact

#### 1.0.0

First release of `@synergyconnectapp/n8n-nodes-synergy-connect`. It is a new package for Synergy Connect and is not related to the `n8n-nodes-synergy-connect` package of the previous Synergy platform.

- **Synergy Connect** (action node): 14 message operations, Media, Template (Get Many, Get, Create, Update, Delete, Upload Example Media), Hand Off to Agent and Send Flow
- **Synergy Connect Trigger**: registers its webhook on the API (reused on restart, kept per URL), has events and outputs per event type, requires a valid `X-Synergy-Signature` (300 s, no fallback to `X-Hub-Signature-256`) before anything runs, and ignores pings and Instagram envelopes
- Credential **Synergy Connect API**: `syn_…` key, Base URL (default `https://api.synergyconnect.com.br`) and an optional default Phone Number ID; the test reads `GET /v1/me` and never sends a message. A legacy or non-https Base URL is refused before any request
- Published with provenance from a workflow whose Actions are pinned by SHA
