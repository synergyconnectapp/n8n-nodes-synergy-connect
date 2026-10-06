# @synergyconnectapp/n8n-nodes-synergy-connect

Community nodes for [n8n](https://n8n.io/) that connect your workflows to [Synergy Connect](https://synergyconnect.com.br/): send WhatsApp messages, manage media, templates and WhatsApp Flows, hand conversations to your agents, and receive events.

![n8n](https://img.shields.io/badge/n8n-community%20node-ff6d5a)
![license](https://img.shields.io/npm/l/@synergyconnectapp/n8n-nodes-synergy-connect)

The nodes talk to the Synergy Connect API (`https://api.synergyconnect.com.br`, `syn_…` keys). The guide of the nodes is at [synergyconnect.com.br/developers/n8n](https://synergyconnect.com.br/developers/n8n) and the API reference at [synergyconnect.com.br/developers/reference](https://synergyconnect.com.br/developers/reference).

- [Installation](#installation)
- [Credentials](#credentials)
- [Synergy Connect (action node)](#synergy-connect-action-node)
- [Synergy Connect Trigger](#synergy-connect-trigger)
- [Development](#development)

## Installation

In n8n: **Settings → Community Nodes → Install**, then enter `@synergyconnectapp/n8n-nodes-synergy-connect`.

Or with npm, next to your n8n:

```bash
npm install @synergyconnectapp/n8n-nodes-synergy-connect
```

## Credentials

Create the credential **Synergy Connect API**:

| Field | Required | Description |
|-------|----------|-------------|
| API Key | Yes | A `syn_…` key with the scopes `messages` and `management` |
| Base URL | No | `https://api.synergyconnect.com.br` by default |
| Phone Number ID | No | Default number (`phone_number_id`), used when the node does not choose one |

**Creating the key.** In the Synergy Connect app open **Configurações → API e webhooks → Chaves de API → Nova chave** (the app is in Portuguese: "Settings → API and webhooks → API keys → New key"), create a key with the scopes **`messages`** and **`management`**, and paste it into the credential. See the [authentication guide](https://synergyconnect.com.br/developers/authentication).

- `messages`: sending, media, reading templates, Hand Off and Flows.
- `management`: the trigger registers its webhook with it, and Template **Create / Update / Delete / Upload Example Media** need it.
- `onboarding`: only if the trigger listens to **Onboarding Result**.

A key can be limited to some numbers; the node lists only those.

**The credential test never sends anything.** It reads `GET /v1/me`. A wrong key fails with a clear message.

**Safety rules.** Before any request the node refuses a Base URL that is not `https:` (*"The Synergy Connect API URL must use https."*), that carries a user name or password, or that has a path (the Base URL is only the address of the API; the node adds the route). The key travels only in `Authorization: Bearer`, only to the origin of the Base URL; redirects are never followed, and error messages never contain the key.

## Synergy Connect (action node)

Pick the **Phone Number** from the list (`GET /v1/numbers`) or by ID. When left empty, the default of the credential is used.

| Resource | Operations |
|----------|------------|
| **Message** | Send Text, Send Image, Send Video, Send Audio (option *Voice*), Send Document, Send Sticker, Send Location, Send Contacts, Send Template, Send Buttons, Send List, Send Reaction, Send Raw (JSON), Mark as Read |
| **Media** | Upload, Get, Download (file in the `binary` field), Delete |
| **Template** | Get Many, Get, Create, Update, Delete, Upload Example Media |
| **Conversation** | Hand Off to Agent |
| **Flow** | Send Flow (issues the flow token and sends the flow in one action) |

What you see in the node panel as text:

```text
Synergy Connect                       [Credential: Synergy Connect API]
  Phone Number   ▾ From list (GET /v1/numbers)  |  By ID
  Resource       ▾ Message | Media | Template | Conversation | Flow
  Operation      ▾ (Message)      Send Text · Send Image · Send Video · Send Audio · Send Document · Send Sticker
                                  Send Location · Send Contacts · Send Template · Send Buttons · Send List
                                  Send Reaction · Send Raw (JSON) · Mark as Read
                 ▾ (Media)        Upload · Get · Download · Delete
                 ▾ (Template)     Get Many · Get · Create · Update · Delete · Upload Example Media
                 ▾ (Conversation) Hand Off to Agent
                 ▾ (Flow)         Send Flow
  Options        + Reply To Message ID · Idempotency Key · Replies Go To · Graph API Version

Synergy Connect Trigger
  Events         ▾ Message Received · Message Status Update · Message Echo · Conversation Status Changed · Journey Event · …
  Phone Numbers  ▾ (optional; empty = every number the key reaches)
  Output Mode    ▾ Single Output | Separate by Event Type | Separate by Message Subtype
```

Notes:

- **Send Template** lists the approved templates of the chosen number. Fill the header and body variables, or use *Components (JSON)* for buttons and media headers.
- **Template → Create / Update** take structured fields (name, language, category, header, body with examples, footer, buttons) or *Components (JSON)*. **Delete** returns `{ "deleted": true }`. **Get Many** has *Return All* (up to 100, the API page size) and *Simplify*.
- **Message options**: *Reply To Message ID*, *Idempotency Key* (default `{{$execution.id}}-{{$itemIndex}}`: the same key within 10 minutes never sends twice, so use a different key when two nodes of one workflow send to the same item), *Replies Go To* (agents queue or back to the integration) and *Graph API Version* (`v25.0`).
- **Hand Off to Agent** needs a plan with the inbox. On the Developer plan it fails with *"Hand Off needs a plan with the inbox (not available on the Developer plan)"*.
- Errors explain `401` and `403` (which scope the operation needs, the plan), and `429` (`Retry-After`).
- The **Phone Number ID** is the `phone_number_id` of the number (5 to 20 digits), the same one `GET /v1/numbers` lists.
- Instagram is not part of 1.0: the node speaks WhatsApp only.

## Synergy Connect Trigger

Starts a workflow when Synergy Connect delivers an event. **Activating the workflow registers the webhook** (`POST /v1/webhooks`, named `n8n · <workflow> · prod`); deactivating it deletes the webhook. Activating again (for example after restarting n8n) reuses the webhook that already exists instead of creating a second one.

- **Events**: Message Received, Message Status Update (with a status filter), Message Echo, Conversation Status Changed, **Journey Event**, Template Status / Quality / Category Update, Phone Number Quality / Name Update, Account Update / Alerts, Group Lifecycle / Participants / Settings, **Onboarding Result**, and under *Advanced Events* calls, history, app state sync and business capability. They are the `fields` of the webhook: Synergy Connect only sends the chosen ones. The [event catalog](https://synergyconnect.com.br/developers/webhooks) describes each payload.
- **Phone Numbers**: optional. Empty means every number the key reaches.
- **Output Mode**: *Single Output*, *Separate by Event Type*, or *Separate by Message Subtype* (Text, Image, Video, Audio, Document, Sticker, Location, Contacts, Reaction, Button Reply, List Reply, **Flow Response**, Order, Other Messages, plus one output per other chosen event).
- Each item carries `_deliveryId`, `_timestamped`, `_eventType`, `_instanceId` and `_wabaId`. Deliveries are at-least-once: use `_deliveryId` to ignore repeats.
- n8n must be reachable at a **public `https` URL** (set `WEBHOOK_URL`; a tunnel works for tests). Synergy Connect refuses `http:`, `localhost` and private addresses, and the trigger tells you before calling.
- Test mode (*Listen for test event*) registers its own webhook (`… · test`) and never touches the one of the active workflow: the secrets are kept per webhook URL.

**Signature check.** Every delivery is verified before anything runs:

1. `X-Synergy-Signature` (`t=<unix>,v1=<hmac>` over `t.deliveryId.body`) is mandatory: the node accepts a timestamp within 300 seconds and trusts the delivery id only after that. A delivery without it is refused, and `X-Hub-Signature-256` is never used as a fallback (it has no timestamp, so a captured delivery could be replayed forever).
2. Bad format, wrong length, wrong secret, old timestamp, missing raw body or an empty secret all answer `401` and **start no execution**. The comparison is constant time.
3. Only after the signature: a body made only of `synergy_ping` events (the proof Synergy Connect sends when the webhook is created) answers `200` and does not start the workflow, and so does an envelope of an Instagram account.

## Development

```bash
npm install
npm run lint
npm run build
npx vitest run
npx vitest run test/redteam
npm run test:contract
```

`test/contract.test.ts` checks every HTTP call of the two nodes (method, path, query, headers and body), the events of the trigger and the signature vector against the OpenAPI document of the API. The document comes from `OPENAPI_FILE` (a local `openapi.json`), from `OPENAPI_URL` (a published one) or, inside the Synergy Connect monorepo, from the server code itself. Without any of the three the contract tests are skipped.

The package has no runtime dependencies, reads no environment variables and touches no files. Releases are published to npm from GitHub Actions with provenance (npm Trusted Publisher, no token); see [`publish.yml`](.github/workflows/publish.yml) and the [CHANGELOG](CHANGELOG.md).

## Links

- [Synergy Connect](https://synergyconnect.com.br/)
- [Synergy Connect for developers](https://synergyconnect.com.br/developers): guides, API reference and the [n8n guide](https://synergyconnect.com.br/developers/n8n)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
