# Code Rating: Agent Door Gateway

**Overall Score: 9.5 / 10**

---

## Summary

Agent Door is a hosted gateway service that provides standardized agent access to any website via the agents-protocol. The codebase has undergone three rounds of hardening and now features comprehensive security, 45 tests, full observability (metrics, request tracing, API docs), and production-grade operational patterns.

---

## Category Scores

| Category | Score | Notes |
|---|---|---|
| Code Quality & Readability | 9/10 | Clean, well-structured, clear section comments |
| Architecture & Design | 9/10 | Testable factory pattern, DI, shared helpers |
| Type Safety | 9/10 | Strict TypeScript, runtime narrowing, no `any` in app code |
| Error Handling | 9/10 | Input validation, global error handler, safe error messages |
| Security | 9/10 | SSRF prevention, auth, rate limiting, body limits, helmet, CORS |
| Testing | 9/10 | 45 tests covering happy paths, security, observability, edge cases |
| Production Readiness | 10/10 | Graceful shutdown, persistence, atomic writes, metrics, request IDs |
| Observability | 9/10 | Request IDs, structured JSON logs, /metrics endpoint, health stats |
| Documentation | 9/10 | README, .env.example, self-hosted OpenAPI spec at /openapi.json |

---

## Strengths

### Comprehensive Security

- **SSRF prevention**: All user-provided URLs validated — scheme restricted to http/https, private IP ranges blocked (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, localhost, ::1)
- **Authentication**: API key auth with timing-safe comparison (`timingSafeEqual`) to prevent timing attacks
- **Rate limiting**: Configurable via env vars, standard headers, sensible defaults
- **Request body limits**: 100kb max payload prevents memory exhaustion
- **Fetch safety**: 30-second timeout on outbound requests, 10MB spec size cap
- **Security headers**: Helmet middleware for standard protections
- **CORS**: Configurable origin whitelist via `CORS_ORIGINS` env var
- **Error isolation**: Internal URLs and error details never leaked to clients

### Full Observability

- **Request ID correlation**: Every request gets a UUID via `X-Request-Id` header (generated or echoed from caller)
- **Structured logging**: JSON format with requestId, method, path, status, duration
- **Metrics endpoint**: `GET /metrics` returns total requests, avg duration, status code breakdown, door count, memory usage
- **Enhanced health check**: `GET /` returns uptime, door count, memory stats alongside service info

### Self-Documenting API

- **OpenAPI 3.0.3 spec** served at `GET /openapi.json` — covers all endpoints, auth schemes, request/response shapes
- Consumers can import directly into Swagger UI, Postman, or any OpenAPI-compatible tooling

### Robust Testing (45 tests)

- Health check with operational stats, request ID generation/echo, metrics accumulation, OpenAPI spec validation
- Registration flow, validation, auth, slug routing
- URL validation: file://, ftp://, localhost, cloud metadata IPs, private networks, malformed URLs
- Fetch safety: oversized specs, timeouts
- Body size limits: 413 for payloads over 100kb
- Error message sanitization: no URL leakage
- Registry: CRUD, file persistence, atomic writes, corrupted file recovery
- `validateUrl` unit tests for scheme and format validation

### Production-Ready Operations

- **Graceful shutdown**: SIGTERM/SIGINT handlers drain connections and destroy doors
- **File persistence**: Registry survives restarts with atomic write-then-rename
- **Config validation**: Production mode requires API_KEY, all numeric config validated against NaN
- **Render deployment config**: render.yaml with proper environment setup

### Clean Architecture

- `createApp()` factory pattern enables full dependency injection for tests
- Three-file source layout: server.ts (app), registry.ts (persistence), types.ts (interfaces)
- Shared `fetchSpec()` helper eliminates duplication between register and boot
- Exported `validateUrl()` enables unit testing independent of HTTP layer
- Zero external dependencies for observability (uses `crypto.randomUUID()`)

---

## Remaining Gaps (Minor)

### Could Improve

1. **Database for multi-instance**: File-based registry limits to single server. PostgreSQL would enable horizontal scaling.
2. **Load testing**: No performance benchmarks. Should validate behavior under concurrent registration load.
3. **Prometheus format**: Metrics are JSON — add `prom-client` if Prometheus/Grafana is set up.

### Won't Fix (Acceptable Tradeoffs)

- **CSP disabled in helmet**: Intentional — gateway proxies third-party content that would violate CSP
- **CORS defaults to `*`**: Acceptable for API-only service, configurable via `CORS_ORIGINS`
- **Timing-safe length check**: The `a.length !== b.length` short-circuit before `timingSafeEqual` leaks token length but this is standard practice and acceptable risk

---

## Changelog

| Version | Score | Key Changes |
|---|---|---|
| v1 (initial) | 6.0/10 | MVP — no auth, no tests, in-memory only |
| v2 (first hardening) | 7.5/10 | Added auth, rate limiting, helmet, CORS, tests (24), persistence, graceful shutdown |
| v3 (security hardening) | 9.0/10 | SSRF prevention, body limits, fetch timeouts, atomic writes, error sanitization, config validation, 41 tests |
| v4 (observability + docs) | 9.5/10 | Request ID correlation, /metrics endpoint, enhanced health check, OpenAPI spec, 45 tests |
