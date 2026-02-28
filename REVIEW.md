# Agent Door — Pre-Production Code Review

**Date:** 2026-02-28 (final pass)
**Reviewer:** Claude (senior eng)
**Branch:** `claude/pre-production-code-review-jEjXc`
**Status:** All identified issues fixed. Remaining items are infrastructure-level (documented below).

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

Both `specUrl` and `resolvedApiUrl` are validated in `src/server.ts`.

### 2. Admin Authentication — FIXED
`requireAdminKey` middleware gates `/register`, `GET /sites`, and `DELETE /sites/:slug`. Reads `ADMIN_API_KEY` from env. Returns 503 if the key is not configured (fail-closed). Accepts `X-Api-Key` header or `Authorization: Bearer <key>`.

### 3. Reserved Slugs — FIXED
`RESERVED_SLUGS` set blocks `register`, `sites`, `health`, `admin`, `api`, `static`, `assets`, `favicon.ico`, `robots.txt`, `.well-known` from being registered as site slugs, preventing route shadowing.

### 4. Hardcoded Domain — FIXED
`BASE_URL` env var replaces all hardcoded `https://agentdoor.io` references. Defaults to `https://agentdoor.io`.

### 5. Regex from User Input — FIXED
Proxy URL rewriting now uses `startsWith` + `slice` instead of `new RegExp(slug)`.

### 6. Misleading Audit Feature — FIXED
`audit` is hardcoded to `false`. The `AuditManager` in `vendor/sdk/dist/audit.js` is a complete stub.

### 7. Request Body Limit — FIXED
`express.json({ limit: '1mb' })`.

### 8. Build Restored — FIXED
`package.json` build script runs `tsc`. `render.yaml` does `npm install && npm run build`.

### 9. Timing-Safe Admin Key Comparison — FIXED
`requireAdminKey` uses `crypto.timingSafeEqual()` instead of `===` to compare the API key, preventing timing side-channel attacks.

### 10. IPv6 SSRF Bypass — FIXED
Node's `URL` parser preserves brackets on IPv6 hostnames, so `net.isIP('[::1]')` returned `0` and fell through to DNS. Fixed by stripping brackets before `net.isIP()`. Also fixed IPv4-mapped IPv6 hex form (`::ffff:7f00:1` → dotted conversion).

### 11. SDK Proxy Origin Validation — FIXED
Proxy handler validates that the constructed URL's origin matches the registered `baseUrl` origin before fetching, preventing path-traversal escapes.

### 12. Upstream Error Leakage — FIXED
Proxy error messages now only include the HTTP status code, not upstream response bodies.

### 13. Atomic Registry Writes — FIXED
`flush()` writes to temp file then `rename()`s atomically.

### 14. Server Listen Guard — FIXED
`app.listen()` only runs when `require.main === module`, not when imported by tests.

### 15. `dist/` Removed from Git — FIXED
Added to `.gitignore`, removed from tracking.

### 16. README Updated — FIXED
Curl examples include auth headers. Response format matches actual output. False "signed audit artifact" claim removed.

### 17. Doors Restored on Startup — FIXED
`restoreDoors()` in `src/server.ts` rebuilds `AgentDoor` instances from persisted registry on process start. Sites that fail to restore (e.g. upstream spec unavailable) are logged but don't block startup.

### 18. Admin Rate Limiting — FIXED
`requireAdminKey` middleware now enforces 20 req/min per IP using an in-memory sliding window, preventing API key brute-force attacks.

### 19. CORS Configurable — FIXED
CORS `Access-Control-Allow-Origin` is now configurable via `CORS_ORIGIN` env var (passed through as `corsOrigin` in `AgentDoorConfig`). Defaults to `*` for backwards compatibility. Set to a specific origin for production.

### 20. Session Tokens Use crypto.randomBytes — FIXED
`vendor/sdk/dist/session.js` now uses `crypto.randomBytes(32).toString('hex')` instead of `uuid.v4()`, producing cryptographically opaque 256-bit session tokens.

### 21. Graceful Shutdown — FIXED
SIGTERM/SIGINT handlers drain connections, destroy all `AgentDoor` instances (cleaning up intervals), and exit. Force-exits after 10s if connections aren't drained.

### 22. Request Logging — FIXED
Logging middleware in `src/server.ts` logs `METHOD /path STATUS TIMEms` for every request.

---

## Required Env Vars (set in Render before deploy)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `ADMIN_API_KEY` | **Yes** | *(none — 503 if unset)* | Authenticates admin endpoints |
| `BASE_URL` | No | `https://agentdoor.io` | Public URL used in response payloads |
| `PORT` | No | `3000` | Server listen port (Render sets this) |
| `CORS_ORIGIN` | No | `*` | CORS `Access-Control-Allow-Origin` value |

---

## Known Issues Still Open

### LOW — Render free tier
Free tier has cold starts, sleeps after 15 min inactivity, and limited bandwidth. Not suitable for a production gateway that agents depend on.

### LOW — Admin rate limiter is in-memory
The admin rate limiter shares the same single-process limitation as sessions and the SDK rate limiter. If the service scales horizontally, it needs Redis or similar shared storage.

### LOW — No CI pipeline
Tests exist (`vitest run`) but there is no CI configuration (GitHub Actions, etc.) to run them automatically on push/PR.

---

## Architecture Notes for Future Work

- **Registry persistence:** The `Registry` class writes to `data/sites.json`. For production scale, replace with a database-backed store. The interface (`register`, `get`, `list`, `delete`) can wrap any backend.
- **SDK is vendored JS-only:** `vendor/sdk/` has no TypeScript source, no tests, no way to rebuild. Changes require editing compiled JS directly. Consider publishing as a proper package.
- **Single-process architecture:** Everything runs in one Node process. Horizontal scaling requires moving session store, rate limiters, and registry to shared storage (Redis, DB).

---

## Test Coverage

31 tests across 2 test files:

- `src/url-guard.test.ts` (12 tests): protocol validation, garbage URLs, all private IP ranges (IPv4, IPv6, IPv4-mapped IPv6, link-local, metadata), positive case (public IPs)
- `src/server.test.ts` (19 tests): health endpoint, auth (6 cases), registration validation (7 cases including SSRF), CRUD operations, 503 on missing key, admin rate limiting (429)
