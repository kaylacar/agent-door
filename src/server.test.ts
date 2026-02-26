import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { app, isPublicUrl, isPrivateIP } from './server';

// ─── Unit: isPrivateIP ───────────────────────────────────────────────────────

describe('isPrivateIP', () => {
  it('blocks loopback', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('127.0.0.2')).toBe(true);
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
