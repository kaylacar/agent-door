# Agent Door — Pre-Production Code Review

**Date:** 2026-02-28
**Reviewer:** Claude (senior eng, first-day review)
**Branch:** `claude/pre-production-code-review-jEjXc`
**Status:** Critical fixes applied. Remaining items documented below.

---

## What This Service Does

Agent Door is a hosted gateway that gives autonomous agents managed access to any website. An operator registers a site (providing an OpenAPI spec URL), and the gateway exposes standardized agents-protocol endpoints for discovery, session management, rate limiting, and proxied API calls.

**Stack:** Node.js, Express, TypeScript, vendored `@agents-protocol/sdk`.
**Deploy target:** Render.com (free tier).
**Source files:** `src/server.ts`, `src/registry.ts`, `src/types.ts`, `src/url-guard.ts`.

---

## Fixes Applied (this branch)

### 1. SSRF Vulnerability — FIXED
`src/url-guard.ts` added. The `/register` endpoint previously fetched any user-supplied URL server-side with no restrictions. Now all URLs are resolved via DNS and checked against private/internal IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x metadata, IPv6 equivalents) before any `fetch()` call.

Both `specUrl` and `resolvedApiUrl` are validated in `src/server.ts:73-80`.

### 2. Admin Authentication — FIXED
`requireAdminKey` middleware in `src/server.ts:23-35` gates `/register`, `GET /sites`, and `DELETE /sites/:slug`. Reads `ADMIN_API_KEY` from env. Returns 503 if the key is not configured (fail-closed). Accepts `X-Api-Key` header or `Authorization: Bearer <key>`.

### 3. Reserved Slugs — FIXED
`RESERVED_SLUGS` set in `src/server.ts:16-19` blocks `register`, `sites`, `health`, `admin`, `api`, `static`, `assets`, `favicon.ico`, `robots.txt`, `.well-known` from being registered as site slugs, preventing route shadowing.

### 4. Hardcoded Domain — FIXED
`BASE_URL` env var in `src/server.ts:13` replaces all hardcoded `https://agentdoor.io` references. Defaults to `https://agentdoor.io`.

### 5. Regex from User Input — FIXED
`src/server.ts:164` now uses `original.startsWith(prefix) ? original.slice(prefix.length)` instead of `new RegExp(slug)`.

### 6. Misleading Audit Feature — FIXED
`audit` is now hardcoded to `false` in `src/server.ts:90,105`. The `AuditManager` in `vendor/sdk/dist/audit.js` is a complete stub (all methods are no-ops). It was previously exposed to users as a working feature.

### 7. Request Body Limit — FIXED
`express.json({ limit: '1mb' })` in `src/server.ts:8`.

### 8. Build Restored — FIXED
`package.json` build script runs `tsc`. `render.yaml` does `npm install && npm run build`.

---

## Required Env Vars (set in Render before deploy)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ADMIN_API_KEY` | **Yes** | *(none — 503 if unset)* | Authenticates admin endpoints |
| `BASE_URL` | No | `https://agentdoor.io` | Public URL used in response payloads |
| `PORT` | No | `3000` | Server listen port (Render sets this) |

---

## Known Issues Still Open

### HIGH — No persistent storage
`src/registry.ts` is an in-memory `Map`. The `doors` map in `src/server.ts:11` is also in-memory. Every restart, deploy, or Render free-tier sleep wipes all registrations. This needs a database (Postgres, SQLite, Redis) before this service can be relied on.

### HIGH — Upstream proxy in SDK has no SSRF guard
The SSRF fix validates URLs at registration time, but the SDK's proxy handler (`vendor/sdk/dist/server.js:82-104`) constructs URLs from `baseUrl` + path parameters at request time. If an attacker can influence path parameters to hit internal services via path traversal in the proxied URL, the guard can be bypassed. The SDK proxy should also validate resolved URLs before fetching, or the `url-guard` module should be integrated into the SDK's `fetch()` calls.

### MEDIUM — CORS is `Access-Control-Allow-Origin: *`
`vendor/sdk/dist/server.js:125` sets wide-open CORS on every response. Any webpage can make requests through the gateway. Consider restricting to known agent origins or at minimum not reflecting credentials.

### MEDIUM — No tests
Zero test files exist. No CI pipeline. The security-critical `url-guard` module especially needs unit tests covering: private IPv4, private IPv6, IPv4-mapped IPv6, DNS resolution to private IP, valid external URLs, edge cases (localhost, 0.0.0.0, etc.).

### MEDIUM — Upstream error leakage
`vendor/sdk/dist/server.js:100-101` passes full upstream response bodies into error messages returned to agents. This can leak internal API details, stack traces, or credentials from proxied services.

### LOW — `dist/` committed to git
The compiled output is checked into the repo. Now that `build` runs `tsc` properly, consider adding `dist/` to `.gitignore` and letting the deploy pipeline build from source.

### LOW — Render free tier
Free tier has cold starts, sleeps after 15 min inactivity, and limited bandwidth. Not suitable for a production gateway that agents depend on.

### LOW — No rate limiting on admin endpoints
The `requireAdminKey` middleware has no rate limiting. An attacker can brute-force the API key. Consider adding rate limiting to `/register`, `GET /sites`, and `DELETE /sites/:slug`.

---

## Architecture Notes for Future Work

- **Registry persistence:** Replace the `Map` in `src/registry.ts` with a database-backed store. The `Registry` class interface (`register`, `get`, `list`, `delete`) is clean and can wrap any backend.
- **SDK is vendored JS-only:** `vendor/sdk/` has no TypeScript source, no tests, no way to rebuild. Changes to SDK behavior require editing compiled JS directly. Consider publishing the SDK as a proper package or at minimum keeping the source alongside the compiled output.
- **Session tokens are UUIDs:** `vendor/sdk/dist/session.js:16` uses `uuid.v4()` for session tokens. These are not cryptographically opaque — consider using `crypto.randomBytes(32).toString('hex')` for session tokens if sessions ever carry authorization weight.
- **Single-process architecture:** Everything runs in one Node process. If this needs to scale horizontally, the in-memory session store, rate limiter, and registry all need to move to shared storage (Redis, DB).
