# Test Coverage Analysis

## Current State

The project currently has **zero test coverage**. There are no test files, no test
framework installed, and no `test` script in `package.json`. This means every code
path in the application is untested.

The codebase is small (3 source files, ~170 lines), which makes this an ideal time
to establish a test foundation before the project grows.

---

## Recommended Test Framework Setup

Add the following dev dependencies:

```
vitest (fast, TypeScript-native, no config needed)
supertest (HTTP assertions for Express apps)
```

Add a `test` script to `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

---

## Proposed Test Areas (Priority Order)

### 1. Registry unit tests — `src/registry.ts`

**Priority: High | Effort: Low**

The `Registry` class is a pure, self-contained data structure with no external
dependencies — the easiest and highest-value place to start.

| Test case | What it validates |
|-----------|-------------------|
| `register()` stores a site | Core write path |
| `get()` returns a registered site | Core read path |
| `get()` returns `null` for unknown slug | Null-safety |
| `list()` returns all registered sites | Enumeration |
| `list()` returns empty array when empty | Edge case |
| `delete()` removes a site and returns `true` | Core delete path |
| `delete()` returns `false` for unknown slug | Edge case |
| Re-registering the same slug overwrites | Idempotency behavior |

### 2. Registration endpoint validation — `POST /register`

**Priority: High | Effort: Medium**

The registration endpoint has complex validation logic (lines 21–34 of `server.ts`)
that is entirely untested. These are critical guardrails.

| Test case | What it validates |
|-----------|-------------------|
| Returns 400 when `slug` is missing | Required field check |
| Returns 400 when `siteName` is missing | Required field check |
| Returns 400 when `siteUrl` is missing | Required field check |
| Returns 400 when neither `apiUrl` nor `openApiUrl` provided | API URL requirement |
| Returns 400 for invalid slug format (uppercase, special chars, too short/long) | Regex validation |
| Returns 409 when slug is already registered | Duplicate prevention |
| Returns 400 when OpenAPI spec fetch fails | External dependency failure |
| Returns 200 with correct gateway URLs on success | Happy path |
| Defaults `rateLimit` to 60 when not provided | Default value logic |
| Defaults `audit` to `false` when not provided | Default value logic |
| Uses `siteUrl` as `apiUrl` when `apiUrl` is not provided | Fallback logic |

### 3. Site listing endpoint — `GET /sites`

**Priority: Medium | Effort: Low**

| Test case | What it validates |
|-----------|-------------------|
| Returns empty array when no sites registered | Empty state |
| Returns all registered sites with correct shape | Response schema |
| Includes `gateway_url` with correct slug prefix | URL construction |

### 4. Site deletion endpoint — `DELETE /sites/:slug`

**Priority: Medium | Effort: Low**

| Test case | What it validates |
|-----------|-------------------|
| Returns 404 for unknown slug | Error path |
| Returns 200 and removes the site | Happy path |
| Calls `door.destroy()` on the AgentDoor instance | Resource cleanup |
| Site no longer appears in `GET /sites` after deletion | End-to-end consistency |

### 5. Agent Door routing middleware — `/:slug/*`

**Priority: Medium | Effort: Medium**

| Test case | What it validates |
|-----------|-------------------|
| Returns 404 for unregistered slug | Error path |
| Strips the slug prefix from `req.url` before forwarding | URL rewriting (line 124) |
| Restores original URL if door middleware calls `next()` | Fallthrough behavior |
| Forwards request to the correct AgentDoor instance | Routing correctness |

### 6. Health check — `GET /`

**Priority: Low | Effort: Very Low**

| Test case | What it validates |
|-----------|-------------------|
| Returns 200 with `{ ok: true }` | Liveness probe |
| Includes correct `service` and `version` fields | Response content |

### 7. Slug regex edge cases

**Priority: Medium | Effort: Low**

The regex `/^[a-z0-9-]{2,40}$/` on line 31 has boundary conditions worth covering:

| Input | Expected | What it validates |
|-------|----------|-------------------|
| `"a"` | Reject | Min length = 2 |
| `"ab"` | Accept | Lower bound |
| `"a]` (40 chars) | Accept | Upper bound |
| `"a"` (41 chars) | Reject | Exceeds max length |
| `"Hello"` | Reject | Uppercase |
| `"my_site"` | Reject | Underscores not allowed |
| `"my site"` | Reject | Spaces not allowed |
| `"my.site"` | Reject | Dots not allowed |
| `"valid-slug-123"` | Accept | Mixed valid characters |
| `"-leading"` | Accept | Leading hyphen (is this intended?) |

> Note: The regex currently allows leading/trailing hyphens. Consider whether this
> is intentional — a test would document this decision either way.

---

## Architectural Considerations

### Testability Improvements

The current `server.ts` has a testability issue: the `Registry` and `doors` Map are
module-level singletons (lines 9–10), which means state leaks between tests. To fix
this:

1. **Extract an `createApp()` factory function** that accepts dependencies and returns
   the Express app. This enables each test to get a fresh instance.
2. **Mock `fetch`** for the OpenAPI spec retrieval in registration tests (line 45),
   so tests don't depend on external HTTP calls.
3. **Mock `AgentDoor.fromOpenAPI`** to avoid needing real OpenAPI specs during unit
   testing of the registration flow.

### What Not to Test

- The vendored `@agents-protocol/sdk` — it's third-party code and out of scope.
- The compiled `dist/` directory — test the TypeScript source, not the build output.
- The `render.yaml` deployment config — infrastructure, not application logic.

---

## Summary

| Area | Priority | Effort | Test count |
|------|----------|--------|------------|
| Registry unit tests | High | Low | ~8 |
| POST /register validation | High | Medium | ~11 |
| GET /sites | Medium | Low | ~3 |
| DELETE /sites/:slug | Medium | Low | ~4 |
| Agent Door routing | Medium | Medium | ~4 |
| GET / health check | Low | Very Low | ~2 |
| Slug regex edge cases | Medium | Low | ~10 |
| **Total** | | | **~42** |

Starting with the Registry unit tests and registration validation would cover the
highest-risk code paths with the least effort.
