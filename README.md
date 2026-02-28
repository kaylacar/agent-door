# Agent Door

Managed agent access for any website. Point us at your API, get a hosted agent door at `agentdoor.io/your-slug`.

Built on the [agents-protocol](https://github.com/kaylacar/agents-protocol) open standard.

---

## How it works

1. You have an API (or an OpenAPI spec)
2. You register it with Agent Door
3. Agents access your site through `agentdoor.io/your-slug`
4. Sessions, rate limiting, and audit trails are handled for you

No code changes to your site. No SDK to install. One registration call.

---

## Register a site

Admin endpoints require an API key (set via `ADMIN_API_KEY` env var):

```bash
curl -X POST https://agentdoor.io/register \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  -d '{
    "slug": "my-store",
    "siteName": "My Store",
    "siteUrl": "https://my-store.com",
    "openApiUrl": "https://my-store.com/openapi.json"
  }'
```

Response:

```json
{
  "slug": "my-store",
  "gatewayUrl": "https://agentdoor.io/my-store",
  "agentsTxt": "https://agentdoor.io/my-store/.well-known/agents.txt",
  "agentsJson": "https://agentdoor.io/my-store/.well-known/agents.json"
}
```

Agents can now discover and interact with your site through the gateway.

---

## What agents get

- `GET /my-store/.well-known/agents.txt` — human-readable capability declaration
- `GET /my-store/.well-known/agents.json` — machine-readable manifest
- `POST /my-store/.well-known/agents/api/session` — create a session
- `GET /my-store/.well-known/agents/api/*` — all capabilities declared in your spec

Sessions track agent activity through the gateway.

---

## Development

```bash
npm install
npm run dev
```

The gateway runs on port 3000. Set `ADMIN_API_KEY` and register a local site:

```bash
export ADMIN_API_KEY=dev-key-change-me
npm run dev
```

```bash
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  -d '{
    "slug": "test",
    "siteName": "Test API",
    "siteUrl": "https://petstore3.swagger.io",
    "openApiUrl": "https://petstore3.swagger.io/api/v3/openapi.json"
  }'
```

---

MIT
