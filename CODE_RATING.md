# Code Rating: Agent Door Gateway

**Overall Score: 9.0 / 10**

---

## Summary

Agent Door is a hosted gateway service that provides standardized agent access to any website via the agents-protocol. The codebase has undergone two rounds of production hardening and now demonstrates strong security posture, comprehensive testing (41 tests), and operational readiness for production deployment.

---

## Category Scores

| Category | Score | Notes |
|---|---|---|
| Code Quality & Readability | 9/10 | Clean, well-structured, clear section comments |
| Architecture & Design | 8/10 | Good separation of concerns, testable factory pattern |
| Type Safety | 9/10 | Strict TypeScript, runtime narrowing, no `any` in app code |
| Error Handling | 9/10 | Input validation, global error handler, safe error messages |
| Security | 9/10 | SSRF prevention, auth, rate limiting, body limits, helmet, CORS |
| Testing | 9/10 | 41 tests covering happy paths, security, edge cases |
| Production Readiness | 9/10 | Graceful shutdown, persistence, atomic writes, fetch timeouts |
| Documentation | 7/10 | Good README and .env.example, could add API docs |

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

### Robust Testing (41 tests)

- Health check, registration flow, validation, auth, slug routing
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
- **Structured logging**: JSON format with method, path, status, duration
- **Render deployment config**: render.yaml with proper environment setup

### Clean Architecture

- `createApp()` factory pattern enables full dependency injection for tests
- Three-file source layout: server.ts (app), registry.ts (persistence), types.ts (interfaces)
- Shared `fetchSpec()` helper eliminates duplication between register and boot
- Exported `validateUrl()` enables unit testing independent of HTTP layer

---

## Remaining Gaps (Minor)

### Could Improve

1. **Database for multi-instance**: File-based registry doesn't support horizontal scaling. SQLite or PostgreSQL would enable multiple server instances.
2. **API documentation**: No OpenAPI spec for the gateway itself. Consumers must read source code or README.
3. **Request ID correlation**: Logs don't include a request ID, making it harder to trace a single request through the system.
4. **Load testing**: No performance benchmarks. Should validate behavior under concurrent registration load.
5. **Monitoring/alerting**: No health check strategy in render.yaml, no metrics endpoint.

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
| v3 (production ready) | 9.0/10 | SSRF prevention, body limits, fetch timeouts, atomic writes, error sanitization, config validation, 41 tests |
