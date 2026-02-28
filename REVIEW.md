# Agent Door — Pre-Production Code Review

**Date:** 2026-02-28 (updated)
**Reviewer:** Claude (senior eng, second review pass)
**Branch:** `claude/pre-production-code-review-jEjXc`
**Status:** Additional security and production fixes applied. Remaining items documented below.

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

### 9. Timing-Safe Admin Key Comparison — FIXED
`requireAdminKey` in `src/server.ts` now uses `crypto.timingSafeEqual()` instead of `===` to compare the API key, preventing timing side-channel attacks on key brute-forcing.

### 10. IPv6 SSRF Bypass — FIXED
`src/url-guard.ts` had a bug where IPv6 literal URLs (e.g. `http://[::1]/`) bypassed the private IP check. Node's `URL` parser preserves brackets in `hostname`, so `net.isIP('[::1]')` returned `0` and the address fell through to DNS resolution instead of being caught as a private IP. Fixed by stripping brackets before the `net.isIP()` check.

Also fixed IPv4-mapped IPv6 in hex form: the URL parser normalizes `::ffff:127.0.0.1` to `::ffff:7f00:1`, which `isPrivateV6` didn't handle. Added hex-to-dotted conversion for the mapped portion.

### 11. SDK Proxy Origin Validation — FIXED
`vendor/sdk/dist/server.js` proxy handler now validates that the constructed URL's origin matches the registered `baseUrl` origin before fetching, preventing path-traversal attacks from escaping the intended upstream host.

### 12. Upstream Error Leakage — FIXED
`vendor/sdk/dist/server.js` no longer includes upstream response bodies in error messages returned to agents. Error messages now only include the HTTP status code (e.g. `Upstream returned 500`).

### 13. Atomic Registry Writes — FIXED
`src/registry.ts` `flush()` now writes to a temp file then `rename()`s atomically, preventing data corruption from interrupted writes or concurrent flushes.

### 14. Server Listen Guard — FIXED
`src/server.ts` now only calls `app.listen()` when run directly (`require.main === module`), not when imported by tests. Previously, importing the module in tests would start a listener on port 3000 as a side effect.

### 15. `dist/` Removed from Git — FIXED
`dist/` added to `.gitignore` and removed from tracking. The build pipeline generates it from source.

### 16. README Updated — FIXED
Curl examples now include `X-Api-Key` auth header. Response format updated to match actual server output. Misleading "signed audit artifact" claim removed.

---

## Required Env Vars (set in Render before deploy)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ADMIN_API_KEY` | **Yes** | *(none — 503 if unset)* | Authenticates admin endpoints |
| `BASE_URL` | No | `https://agentdoor.io` | Public URL used in response payloads |
| `PORT` | No | `3000` | Server listen port (Render sets this) |

---

## Known Issues Still Open

### HIGH — `doors` Map is in-memory only
`src/registry.ts` now persists site registrations to `data/sites.json`, but the `doors` Map in `src/server.ts:11` (which holds live `AgentDoor` instances) is rebuilt only when sites are registered. On restart, registrations survive in the JSON file but the `AgentDoor` middleware instances are lost. The server needs a startup routine that reconstructs `AgentDoor` instances from the registry, or the entire system needs a database-backed approach.

### MEDIUM — CORS is `Access-Control-Allow-Origin: *`
`vendor/sdk/dist/server.js:118` sets wide-open CORS on every response. Any webpage can make requests through the gateway. Consider restricting to known agent origins or at minimum not reflecting credentials.

### MEDIUM — No rate limiting on admin endpoints
The `requireAdminKey` middleware has no rate limiting. An attacker can brute-force the API key (mitigated by timing-safe comparison, but not prevented). Consider adding rate limiting to `/register`, `GET /sites`, and `DELETE /sites/:slug`.

### MEDIUM — Session tokens are UUIDs
`vendor/sdk/dist/session.js:16` uses `uuid.v4()`. Consider `crypto.randomBytes(32).toString('hex')` if sessions ever carry authorization weight.

### LOW — Render free tier
Free tier has cold starts, sleeps after 15 min inactivity, and limited bandwidth. Not suitable for a production gateway that agents depend on.

### LOW — No graceful shutdown
No SIGTERM handler — in-flight requests are dropped and cleanup intervals in `SessionManager`/`RateLimiter` are never cleared on shutdown.

### LOW — No request logging
No structured logging for requests, auth events, or errors. Add a logging library (pino, winston) for production observability.

---

## Architecture Notes for Future Work

- **Registry persistence:** Replace the `Map` in `src/registry.ts` with a database-backed store. The `Registry` class interface (`register`, `get`, `list`, `delete`) is clean and can wrap any backend.
- **SDK is vendored JS-only:** `vendor/sdk/` has no TypeScript source, no tests, no way to rebuild. Changes to SDK behavior require editing compiled JS directly. Consider publishing the SDK as a proper package or at minimum keeping the source alongside the compiled output.
- **Session tokens are UUIDs:** `vendor/sdk/dist/session.js:16` uses `uuid.v4()` for session tokens. These are not cryptographically opaque — consider using `crypto.randomBytes(32).toString('hex')` for session tokens if sessions ever carry authorization weight.
- **Single-process architecture:** Everything runs in one Node process. If this needs to scale horizontally, the in-memory session store, rate limiter, and registry all need to move to shared storage (Redis, DB).
