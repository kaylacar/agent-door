# Code Rating: Agent Door Gateway

**Overall Score: 6.0 / 10**

---

## Summary

Agent Door is a hosted gateway service that provides standardized agent access to any website via the agents-protocol. The codebase is small (~170 LOC across 3 source files), clean, and focused. It demonstrates solid fundamentals for an MVP but has significant gaps in security, testing, and production readiness.

---

## Category Scores

| Category | Score | Notes |
|---|---|---|
| Code Quality & Readability | 7/10 | Clean, well-structured, easy to follow |
| Architecture & Design | 7/10 | Good separation of concerns, pragmatic choices |
| Type Safety | 7/10 | Strict TypeScript with proper runtime narrowing |
| Error Handling | 6/10 | Solid input validation, missing global error handling |
| Security | 4/10 | No authentication, no CORS, no rate limiting on gateway |
| Testing | 1/10 | No tests whatsoever |
| Production Readiness | 5/10 | In-memory storage, no persistence, no graceful shutdown |
| Documentation | 6/10 | Good README and section comments, no API docs |

---

## Strengths

### Clean Code Structure
The three-file layout (`server.ts`, `registry.ts`, `types.ts`) is well-factored. Each file has a single responsibility. The main server file uses clear section comments (`// ─── Health check ──`) that make navigation easy.

### Solid Input Validation
The `/register` endpoint validates all required fields with specific error messages, checks slug format with a sensible regex (`/^[a-z0-9-]{2,40}$/`), and checks for duplicate slugs. Each validation returns an appropriate HTTP status code (400, 409).

### Pragmatic Architecture
- Vendoring the SDK eliminates external dependency risk for deployment
- The middleware composition pattern for routing (`/:slug` -> strip prefix -> delegate to door middleware -> restore URL) is elegant
- Pre-building dist and committing it removes the compilation step from deployment

### Good TypeScript Practices
- `strict: true` in tsconfig
- `req.body as Record<string, unknown>` followed by manual `typeof` narrowing is safer than blindly casting to a known interface
- Proper use of nullish coalescing (`??`) and optional chaining

---

## Weaknesses

### No Authentication (Critical)
Every endpoint is completely open:
- Anyone can register a new slug (`POST /register`)
- Anyone can delete any registration (`DELETE /sites/:slug`)
- Anyone can list all registered sites (`GET /sites`)

This is the single biggest issue. In production, a malicious actor could squat on slugs, delete others' registrations, or enumerate all registered APIs.

### No Tests
There are zero test files in the project. For a gateway service that proxies traffic between agents and APIs, testing is essential. At minimum, the project needs:
- Unit tests for `Registry`
- Integration tests for the registration flow
- Tests for the slug routing/URL-rewriting logic
- Error path coverage

### In-Memory Storage
The `Registry` class and the `doors` Map are both in-memory. Every restart wipes all registrations. This is acceptable for a prototype but unusable for any real deployment.

### No Rate Limiting on the Gateway Itself
While individual `AgentDoor` instances support rate limiting for proxied requests, the gateway endpoints themselves (`/register`, `/sites`, etc.) have no rate limiting. This opens the door to abuse.

### No CORS Configuration
The Express app has no CORS middleware configured. If a frontend is ever intended to call these endpoints, it will be blocked by browsers. Even for API-only usage, explicit CORS policy is a security best practice.

### Hardcoded Gateway URL
The response URLs are hardcoded to `https://agentdoor.io/`:
```typescript
gateway_url: `https://agentdoor.io/${slug}`,
```
This makes local development and staging environments return incorrect URLs. This should be derived from the request host or an environment variable.

### No Global Error Handler
If an unhandled error occurs in the middleware chain, Express will return its default HTML error page. A global error handler should catch these and return consistent JSON responses.

### Regex Created Per Request
In the slug routing middleware:
```typescript
req.url = original.replace(new RegExp(`^/${slug}`), '') || '/';
```
A new `RegExp` is constructed on every request. While the performance impact is minimal, it would be cleaner to use a simple string operation like `original.slice(slug.length + 1)`.

### No Graceful Shutdown
The server doesn't handle `SIGTERM` or `SIGINT`. On deployment platforms like Render, this means in-flight requests may be dropped during deploys. A graceful shutdown handler should drain connections and call `door.destroy()` on all registered doors.

### Unused Dependency
`uuid` is listed in `dependencies` but is never imported or used anywhere in the source code.

---

## Recommendations (Priority Order)

1. **Add authentication** — API keys or JWT tokens for registration/deletion endpoints
2. **Add a test suite** — Jest or Vitest with integration tests for all endpoints
3. **Replace in-memory storage** — SQLite at minimum, PostgreSQL/Redis for production
4. **Add rate limiting** — `express-rate-limit` on gateway endpoints
5. **Make gateway URL configurable** — Use `process.env.GATEWAY_URL` or derive from request
6. **Add global error handler** — Catch-all middleware returning JSON errors
7. **Add graceful shutdown** — Handle SIGTERM, drain connections, destroy all doors
8. **Remove unused `uuid` dependency**
9. **Add CORS middleware** — Even if restrictive, make it explicit
10. **Add request logging** — Morgan or Pino for observability
