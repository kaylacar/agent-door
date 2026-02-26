import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import dns from 'node:dns/promises';
import request from 'supertest';
import { app, isPublicUrl, isPrivateIP, resolveAndValidateUrl, timingSafeEqual, checkRegisterRate, registerWindow } from './server';

// ─── Unit: isPrivateIP ───────────────────────────────────────────────────────

describe('isPrivateIP', () => {
  it('blocks loopback', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.0.0.2')).toBe(true);
  });

  it('blocks 0.0.0.0', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
  });

  it('blocks RFC-1918 ranges', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
    expect(isPrivateIP('172.16.0.1')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
  });

  it('blocks link-local', () => {
    expect(isPrivateIP('169.254.1.1')).toBe(true);
  });

  it('blocks IPv6 loopback and link-local', () => {
    expect(isPrivateIP('::1')).toBe(true);
    expect(isPrivateIP('fe80::1')).toBe(true);
    expect(isPrivateIP('fc00::1')).toBe(true);
    expect(isPrivateIP('fd12::1')).toBe(true);
  });

  it('blocks IPv6-mapped IPv4 private addresses', () => {
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true);
  });

  it('allows IPv6-mapped IPv4 public addresses', () => {
    expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false);
  });

  it('allows public IPs', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('203.0.113.1')).toBe(false);
  });
});

// ─── Unit: isPublicUrl ───────────────────────────────────────────────────────

describe('isPublicUrl', () => {
  it('allows valid HTTPS URLs', () => {
    expect(isPublicUrl('https://example.com')).toBe(true);
    expect(isPublicUrl('https://api.example.com/openapi.json')).toBe(true);
  });

  it('allows valid HTTP URLs', () => {
    expect(isPublicUrl('http://example.com')).toBe(true);
  });

  it('rejects non-HTTP protocols', () => {
    expect(isPublicUrl('ftp://example.com')).toBe(false);
    expect(isPublicUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects localhost', () => {
    expect(isPublicUrl('http://localhost')).toBe(false);
    expect(isPublicUrl('http://localhost:3000')).toBe(false);
    expect(isPublicUrl('http://127.0.0.1')).toBe(false);
  });

  it('rejects private IPs', () => {
    expect(isPublicUrl('http://10.0.0.1')).toBe(false);
    expect(isPublicUrl('http://192.168.1.1')).toBe(false);
    expect(isPublicUrl('http://172.16.0.1')).toBe(false);
  });

  it('rejects cloud metadata endpoints', () => {
    expect(isPublicUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isPublicUrl('http://metadata.google.internal')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isPublicUrl('not-a-url')).toBe(false);
    expect(isPublicUrl('')).toBe(false);
  });
});

// ─── Integration: Health check ───────────────────────────────────────────────

describe('GET /', () => {
  it('returns ok with service info', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      service: 'Agent Door Gateway',
      version: '0.1.0',
    });
  });
});

// ─── Integration: Registration validation ────────────────────────────────────

describe('POST /register', () => {
  it('rejects missing fields', async () => {
    const res = await request(app)
      .post('/register')
      .send({ slug: 'test' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/Missing required fields/);
  });

  it('rejects missing apiUrl and openApiUrl', async () => {
    const res = await request(app)
      .post('/register')
      .send({ slug: 'test', siteName: 'Test', siteUrl: 'https://example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/apiUrl or openApiUrl/);
  });

  it('rejects invalid slug format', async () => {
    const res = await request(app)
      .post('/register')
      .send({ slug: 'UPPER', siteName: 'Test', siteUrl: 'https://example.com', apiUrl: 'https://example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slug must be/);
  });

  it('rejects slug with special characters', async () => {
    const res = await request(app)
      .post('/register')
      .send({ slug: 'a/b', siteName: 'Test', siteUrl: 'https://example.com', apiUrl: 'https://example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/slug must be/);
  });

  it('rejects single-character slug', async () => {
    const res = await request(app)
      .post('/register')
      .send({ slug: 'a', siteName: 'Test', siteUrl: 'https://example.com', apiUrl: 'https://example.com' });
    expect(res.status).toBe(400);
  });

  it('rejects SSRF attempt with localhost', async () => {
    const res = await request(app)
      .post('/register')
      .send({
        slug: 'ssrf-test',
        siteName: 'Test',
        siteUrl: 'http://localhost:8080',
        openApiUrl: 'https://example.com/openapi.json',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/URL not allowed/);
  });

  it('rejects SSRF attempt with private IP', async () => {
    const res = await request(app)
      .post('/register')
      .send({
        slug: 'ssrf-priv',
        siteName: 'Test',
        siteUrl: 'http://192.168.1.1',
        openApiUrl: 'https://example.com/openapi.json',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/URL not allowed/);
  });

  it('rejects SSRF attempt with AWS metadata IP', async () => {
    const res = await request(app)
      .post('/register')
      .send({
        slug: 'ssrf-aws',
        siteName: 'Test',
        siteUrl: 'https://example.com',
        openApiUrl: 'http://169.254.169.254/latest/meta-data',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/URL not allowed/);
  });
});

// ─── Integration: Auth ───────────────────────────────────────────────────────

describe('Admin auth (when ADMIN_KEY is not set)', () => {
  it('allows access to /sites without key in dev mode', async () => {
    const res = await request(app).get('/sites');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ─── Integration: Sites listing ──────────────────────────────────────────────

describe('GET /sites', () => {
  it('returns an array', async () => {
    const res = await request(app).get('/sites');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── Integration: Delete non-existent site ───────────────────────────────────

describe('DELETE /sites/:slug', () => {
  it('returns 404 for non-existent slug', async () => {
    const res = await request(app).delete('/sites/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

// ─── Integration: Slug routing for unregistered slug ─────────────────────────

describe('GET /:slug/.well-known/agents.json', () => {
  it('returns 404 for unregistered slug', async () => {
    const res = await request(app).get('/unregistered/.well-known/agents.json');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/No agent door registered/);
  });
});

// ─── Integration: Registration happy path ────────────────────────────────────

describe('POST /register (happy path)', () => {
  // Use a unique slug per test run to avoid 409 conflicts
  const slug = `hp-${Date.now()}`.slice(0, 20).toLowerCase();

  it('registers a site and returns gateway URLs', async () => {
    // Mock dns.resolve4 to return public IPs for the test domain
    const resolve4Spy = vi.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);
    const resolve6Spy = vi.spyOn(dns, 'resolve6').mockRejectedValue(new Error('no AAAA'));

    // Mock global fetch to return a minimal OpenAPI spec
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0' },
        paths: {
          '/items': {
            get: {
              operationId: 'listItems',
              summary: 'List items',
              parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
            },
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const res = await request(app)
      .post('/register')
      .send({
        slug,
        siteName: 'Happy Path Store',
        siteUrl: 'https://example.com',
        apiUrl: 'https://api.example.com',
        openApiUrl: 'https://api.example.com/openapi.json',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.slug).toBe(slug);
    expect(res.body.data.gateway_url).toContain(`/${slug}`);
    expect(res.body.data.agents_json).toContain(`/${slug}/.well-known/agents.json`);

    resolve4Spy.mockRestore();
    resolve6Spy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('serves agents.json for the registered slug', async () => {
    const res = await request(app).get(`/${slug}/.well-known/agents.json`);
    expect(res.status).toBe(200);
    expect(res.body.schema_version).toBe('1.0');
    expect(res.body.site.name).toBe('Happy Path Store');
    expect(res.body.capabilities.length).toBeGreaterThan(0);
  });

  it('serves agents.txt for the registered slug', async () => {
    const res = await request(app).get(`/${slug}/.well-known/agents.txt`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Happy Path Store');
  });

  it('rejects duplicate slug registration', async () => {
    const resolve4Spy = vi.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);
    const resolve6Spy = vi.spyOn(dns, 'resolve6').mockRejectedValue(new Error('no AAAA'));

    const res = await request(app)
      .post('/register')
      .send({
        slug,
        siteName: 'Duplicate',
        siteUrl: 'https://example.com',
        apiUrl: 'https://api.example.com',
        openApiUrl: 'https://api.example.com/openapi.json',
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already registered/);

    resolve4Spy.mockRestore();
    resolve6Spy.mockRestore();
  });

  afterAll(async () => {
    // Cleanup: delete the test registration
    await request(app).delete(`/sites/${slug}`);
  });
});

// ─── Unit: timingSafeEqual ────────────────────────────────────────────────────

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('secret123', 'secret123')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(timingSafeEqual('secret123', 'secret124')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqual('short', 'muchlonger')).toBe(false);
    expect(timingSafeEqual('', 'notempty')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

// ─── Integration: x-forwarded header safety ──────────────────────────────────

describe('gatewayBase header safety', () => {
  it('does not use forged x-forwarded-host in /sites response', async () => {
    // GET /sites uses gatewayBase to build gateway_url for each site.
    // With trust proxy not configured, x-forwarded-host should be ignored.
    const res = await request(app)
      .get('/sites')
      .set('x-forwarded-host', 'evil.com')
      .set('x-forwarded-proto', 'https');

    expect(res.status).toBe(200);
    // Even if there are registered sites, none should have evil.com in gateway_url
    for (const site of res.body.data) {
      expect(site.gateway_url).not.toContain('evil.com');
    }
  });
});

// ─── Unit: checkRegisterRate ──────────────────────────────────────────────────

describe('checkRegisterRate', () => {
  const testIP = `rate-test-${Date.now()}`;

  afterAll(() => {
    registerWindow.delete(testIP);
  });

  it('allows up to 10 requests then blocks', () => {
    for (let i = 0; i < 10; i++) {
      expect(checkRegisterRate(testIP)).toBe(true);
    }
    // 11th request should be blocked
    expect(checkRegisterRate(testIP)).toBe(false);
  });
});

// ─── Integration: rateLimit parameter validation ─────────────────────────────

describe('POST /register (rateLimit validation)', () => {
  beforeEach(() => {
    // Clear rate limit for loopback to avoid 429 from earlier tests
    registerWindow.delete('::ffff:127.0.0.1');
    registerWindow.delete('127.0.0.1');
  });

  it('rejects negative rateLimit', async () => {
    const res = await request(app)
      .post('/register')
      .send({
        slug: 'rl-neg',
        siteName: 'Test',
        siteUrl: 'https://example.com',
        apiUrl: 'https://example.com',
        rateLimit: -1,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rateLimit must be/);
  });

  it('rejects Infinity rateLimit', async () => {
    const res = await request(app)
      .post('/register')
      .send({
        slug: 'rl-inf',
        siteName: 'Test',
        siteUrl: 'https://example.com',
        apiUrl: 'https://example.com',
        rateLimit: Infinity,
      });
    // Infinity serializes to null in JSON, so it'll be a non-number
    expect(res.status).toBe(400);
  });

  it('rejects rateLimit over 1000', async () => {
    const res = await request(app)
      .post('/register')
      .send({
        slug: 'rl-big',
        siteName: 'Test',
        siteUrl: 'https://example.com',
        apiUrl: 'https://example.com',
        rateLimit: 9999,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rateLimit must be/);
  });

  it('rejects string rateLimit', async () => {
    const res = await request(app)
      .post('/register')
      .send({
        slug: 'rl-str',
        siteName: 'Test',
        siteUrl: 'https://example.com',
        apiUrl: 'https://example.com',
        rateLimit: 'fast',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rateLimit must be/);
  });
});

// ─── Integration: oversized request body ─────────────────────────────────────

describe('POST /register (oversized body)', () => {
  it('rejects body larger than 50KB', async () => {
    const res = await request(app)
      .post('/register')
      .send({ slug: 'big', siteName: 'x'.repeat(60_000), siteUrl: 'https://example.com', apiUrl: 'https://example.com' });
    expect(res.status).toBe(413);
  });
});

// ─── Integration: session lifecycle via registered door ──────────────────────

describe('Session lifecycle', () => {
  const slug = `sess-${Date.now()}`.slice(0, 20).toLowerCase();

  beforeEach(() => {
    // Clear rate limit for this test's IP to avoid 429 from earlier tests
    registerWindow.delete('::ffff:127.0.0.1');
    registerWindow.delete('127.0.0.1');
  });

  it('can create and end a session through the gateway', async () => {
    // Register a site first
    const resolve4Spy = vi.spyOn(dns, 'resolve4').mockResolvedValue(['93.184.216.34']);
    const resolve6Spy = vi.spyOn(dns, 'resolve6').mockRejectedValue(new Error('no AAAA'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'Session Test', version: '1.0' },
        paths: { '/items': { get: { operationId: 'listItems', summary: 'List' } } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const regRes = await request(app).post('/register').send({
      slug,
      siteName: 'Session Test',
      siteUrl: 'https://example.com',
      apiUrl: 'https://api.example.com',
      openApiUrl: 'https://api.example.com/openapi.json',
    });
    expect(regRes.status).toBe(200);

    resolve4Spy.mockRestore();
    resolve6Spy.mockRestore();
    fetchSpy.mockRestore();

    // Create a session
    const sessionRes = await request(app).post(`/${slug}/.well-known/agents/api/session`);
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.ok).toBe(true);
    expect(sessionRes.body.data.session_token).toBeDefined();
    expect(sessionRes.body.data.expires_at).toBeDefined();

    // End the session
    const endRes = await request(app)
      .delete(`/${slug}/.well-known/agents/api/session`)
      .set('Authorization', `Bearer ${sessionRes.body.data.session_token}`);
    expect(endRes.status).toBe(200);
    expect(endRes.body.ok).toBe(true);
  });

  afterAll(async () => {
    await request(app).delete(`/sites/${slug}`);
  });
});
