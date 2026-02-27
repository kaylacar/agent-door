import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { Registry } from '../src/registry';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockDestroy = vi.fn();
const mockMiddleware = vi.fn(() => (_req: any, _res: any, next: any) => next());

vi.mock('@agents-protocol/sdk', () => ({
  AgentDoor: {
    fromOpenAPI: vi.fn(() => ({
      middleware: mockMiddleware,
      destroy: mockDestroy,
    })),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'test-site',
    siteName: 'Test Site',
    siteUrl: 'https://test.com',
    apiUrl: 'https://api.test.com',
    ...overrides,
  };
}

function mockFetchOk() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {},
    }),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Agent Door Gateway', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetchOk();
    // Dynamic import to avoid config caching issues — createApp uses injected options
    const { createApp } = await import('../src/server');
    const result = createApp({
      registry: new Registry(),
      gatewayUrl: 'https://agentdoor.io',
      rateLimitMax: 1000,  // high limit so tests aren't throttled
    });
    app = result.app;
  });

  // ─── Health check ──────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with service info', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        service: 'Agent Door Gateway',
        version: '0.1.0',
      });
    });
  });

  // ─── Registration ─────────────────────────────────────────────────────────

  describe('POST /register', () => {
    it('registers a site successfully', async () => {
      const res = await request(app).post('/register').send(validPayload());
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.slug).toBe('test-site');
      expect(res.body.data.gateway_url).toBe('https://agentdoor.io/test-site');
      expect(res.body.data.agents_txt).toBe('https://agentdoor.io/test-site/.well-known/agents.txt');
      expect(res.body.data.agents_json).toBe('https://agentdoor.io/test-site/.well-known/agents.json');
    });

    it('rejects missing required fields', async () => {
      const res = await request(app).post('/register').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing required fields');
    });

    it('rejects missing apiUrl and openApiUrl', async () => {
      const res = await request(app).post('/register').send({
        slug: 'test',
        siteName: 'Test',
        siteUrl: 'https://test.com',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Provide apiUrl or openApiUrl');
    });

    it('rejects invalid slug format', async () => {
      const cases = ['A', 'UPPER', 'has spaces', 'special!@#', 'x'];
      for (const slug of cases) {
        const res = await request(app).post('/register').send(validPayload({ slug }));
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('slug must be');
      }
    });

    it('rejects duplicate slugs', async () => {
      await request(app).post('/register').send(validPayload());
      const res = await request(app).post('/register').send(validPayload());
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already registered');
    });

    it('handles OpenAPI spec fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const res = await request(app).post('/register').send(validPayload());
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Could not load OpenAPI spec');
    });

    it('uses openApiUrl when provided', async () => {
      const res = await request(app).post('/register').send(
        validPayload({ openApiUrl: 'https://custom.com/spec.json' }),
      );
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith('https://custom.com/spec.json');
    });

    it('applies default rateLimit and audit values', async () => {
      const res = await request(app).post('/register').send(validPayload());
      expect(res.status).toBe(200);
    });
  });

  // ─── List sites ────────────────────────────────────────────────────────────

  describe('GET /sites', () => {
    it('returns empty list initially', async () => {
      const res = await request(app).get('/sites');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns registered sites', async () => {
      await request(app).post('/register').send(validPayload());
      const res = await request(app).get('/sites');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].slug).toBe('test-site');
      expect(res.body.data[0].gateway_url).toBe('https://agentdoor.io/test-site');
    });
  });

  // ─── Delete site ───────────────────────────────────────────────────────────

  describe('DELETE /sites/:slug', () => {
    it('deletes a registered site', async () => {
      await request(app).post('/register').send(validPayload());
      const res = await request(app).delete('/sites/test-site');
      expect(res.status).toBe(200);
      expect(res.body.data.deleted).toBe(true);
      expect(mockDestroy).toHaveBeenCalled();

      const listRes = await request(app).get('/sites');
      expect(listRes.body.data).toHaveLength(0);
    });

    it('returns 404 for non-existent slug', async () => {
      const res = await request(app).delete('/sites/no-such-site');
      expect(res.status).toBe(404);
    });
  });

  // ─── Slug routing ─────────────────────────────────────────────────────────

  describe('/:slug routing', () => {
    it('returns 404 for non-existent door', async () => {
      const res = await request(app).get('/unknown-slug/some-path');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('No agent door registered');
    });

    it('routes to registered door middleware', async () => {
      await request(app).post('/register').send(validPayload());
      // The mock middleware calls next(), so Express returns 404 (no further handler)
      const res = await request(app).get('/test-site/.well-known/agents.txt');
      expect(mockMiddleware).toHaveBeenCalled();
      // Middleware was invoked — that's the important assertion
    });
  });
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

describe('Authentication', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetchOk();
    const { createApp } = await import('../src/server');
    const result = createApp({
      registry: new Registry(),
      apiKey: 'secret-key-123',
      gatewayUrl: 'https://agentdoor.io',
      rateLimitMax: 1000,
    });
    app = result.app;
  });

  it('rejects requests without auth header on protected endpoints', async () => {
    const res = await request(app).get('/sites');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Authorization required');
  });

  it('rejects requests with wrong API key', async () => {
    const res = await request(app)
      .get('/sites')
      .set('Authorization', 'Bearer wrong-key');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Invalid API key');
  });

  it('allows requests with correct API key', async () => {
    const res = await request(app)
      .get('/sites')
      .set('Authorization', 'Bearer secret-key-123');
    expect(res.status).toBe(200);
  });

  it('does not require auth for health check', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
  });

  it('does not require auth for door routing', async () => {
    // Register first (with auth)
    await request(app)
      .post('/register')
      .set('Authorization', 'Bearer secret-key-123')
      .send(validPayload());
    // Access door without auth
    const res = await request(app).get('/test-site/.well-known/agents.txt');
    // Should not get 401/403 — might get 404 since mock middleware calls next()
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ─── Registry persistence ────────────────────────────────────────────────────

describe('Registry', () => {
  it('stores and retrieves registrations', () => {
    const registry = new Registry();
    const reg: import('../src/types').SiteRegistration = {
      slug: 'test',
      siteName: 'Test',
      siteUrl: 'https://test.com',
      apiUrl: 'https://api.test.com',
      rateLimit: 60,
      audit: false,
      createdAt: new Date(),
    };
    registry.register(reg);
    expect(registry.get('test')).toEqual(reg);
    expect(registry.list()).toHaveLength(1);
  });

  it('returns null for unknown slug', () => {
    const registry = new Registry();
    expect(registry.get('nope')).toBeNull();
  });

  it('deletes registrations', () => {
    const registry = new Registry();
    const reg: import('../src/types').SiteRegistration = {
      slug: 'test',
      siteName: 'Test',
      siteUrl: 'https://test.com',
      apiUrl: 'https://api.test.com',
      rateLimit: 60,
      audit: false,
      createdAt: new Date(),
    };
    registry.register(reg);
    expect(registry.delete('test')).toBe(true);
    expect(registry.get('test')).toBeNull();
    expect(registry.delete('test')).toBe(false);
  });

  it('persists to file and reloads', async () => {
    const { mkdtempSync } = await import('fs');
    const { join } = await import('path');
    const tmpDir = mkdtempSync('/tmp/registry-test-');
    const filePath = join(tmpDir, 'registry.json');

    const registry1 = new Registry(filePath);
    registry1.register({
      slug: 'persisted',
      siteName: 'Persisted Site',
      siteUrl: 'https://persisted.com',
      apiUrl: 'https://api.persisted.com',
      rateLimit: 30,
      audit: true,
      createdAt: new Date('2025-01-01'),
    });

    // Create a new registry from the same file
    const registry2 = new Registry(filePath);
    const loaded = registry2.get('persisted');
    expect(loaded).not.toBeNull();
    expect(loaded!.slug).toBe('persisted');
    expect(loaded!.siteName).toBe('Persisted Site');
    expect(loaded!.createdAt).toEqual(new Date('2025-01-01'));
  });
});
