# Agent Door

Managed agent access for any website. Point us at your API, get a hosted agent door.

Built on the [agents-protocol](https://github.com/kaylacar/agents-protocol) open standard.

## How it works

1. You have an API (or an OpenAPI spec)
2. You register it with Agent Door
3. Agents access your site through the gateway
4. Sessions and rate limiting are handled for you

No code changes to your site. No SDK to install. One registration call.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `ADMIN_API_KEY` | API key for admin endpoints. Unset = open (dev only). | — |
| `GATEWAY_BASE_URL` | Public base URL for gateway links in responses | Derived from request |
| `MAX_REGISTRATIONS` | Maximum number of registered sites | `100` |
| `FETCH_TIMEOUT_MS` | Timeout for upstream OpenAPI spec fetches | `10000` |

## Register a site

```bash
curl -X POST https://your-gateway/register \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-admin-key" \
  -d '{
    "slug": "my-store",
    "siteName": "My Store",
    "siteUrl": "https://my-store.com",
    "openApiUrl": "https://my-store.com/openapi.json"
  }'
```

## What agents get

- `GET /:slug/.well-known/agents.txt` — human-readable capability declaration
- `GET /:slug/.well-known/agents.json` — machine-readable manifest
- `POST /:slug/.well-known/agents/api/session` — create a session
- `GET /:slug/.well-known/agents/api/*` — all capabilities declared in your spec

## Development

```bash
npm install
npm run dev
```

The gateway runs on port 3000.

```bash
npm run build   # compile TypeScript
npm start       # run compiled output
```

## License

MIT
