process.env.ADMIN_API_KEY = 'test-key-123';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { app } from './server';

let server: http.Server;
let base: string;

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, { headers });
}

function post(path: string, body: any, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const AUTH = { 'x-api-key': 'test-key-123' };

beforeAll(() => {
  server = app.listen(0);
  const addr = server.address() as { port: number };
  base = `http://localhost:${addr.port}`;
});

afterAll(() => server.close());

describe('health', () => {
  it('returns service info', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect((await res.json()).service).toBe('agent-door');
  });
});

describe('auth', () => {
  it('401 without key', async () => {
    const res = await post('/register', { slug: 'test' });
    expect(res.status).toBe(401);
  });

  it('401 with wrong key', async () => {
    const res = await post('/register', { slug: 'test' }, { 'x-api-key': 'nope' });
    expect(res.status).toBe(401);
  });

  it('passes with x-api-key', async () => {
    const res = await post('/register', {}, AUTH);
    expect(res.status).not.toBe(401);
  });

  it('passes with bearer', async () => {
    const res = await post('/register', {}, { 'Authorization': 'Bearer test-key-123' });
    expect(res.status).not.toBe(401);
  });

  it('GET /sites needs auth', async () => {
    expect((await get('/sites')).status).toBe(401);
  });

  it('DELETE /sites/:slug needs auth', async () => {
    const res = await fetch(`${base}/sites/x`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

describe('registration', () => {
  it('requires slug, siteName, siteUrl', async () => {
    const res = await post('/register', { slug: 'x' }, AUTH);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/i);
  });

  it('requires apiUrl or openApiUrl', async () => {
    const res = await post('/register', {
      slug: 'test-a', siteName: 'T', siteUrl: 'https://example.com',
    }, AUTH);
    expect(res.status).toBe(400);
  });

  it('rejects bad slug', async () => {
    const res = await post('/register', {
      slug: 'CAPS', siteName: 'T', siteUrl: 'https://example.com', apiUrl: 'https://example.com',
    }, AUTH);
    expect(res.status).toBe(400);
  });

  it('rejects leading/trailing hyphens', async () => {
    const res = await post('/register', {
      slug: '-nope-', siteName: 'T', siteUrl: 'https://example.com', apiUrl: 'https://example.com',
    }, AUTH);
    expect(res.status).toBe(400);
  });

  it('rejects reserved slugs', async () => {
    for (const slug of ['register', 'sites', 'admin', 'api']) {
      const res = await post('/register', {
        slug, siteName: 'T', siteUrl: 'https://example.com', apiUrl: 'https://example.com',
      }, AUTH);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/reserved/);
    }
  });

  it('blocks SSRF to metadata endpoint', async () => {
    const res = await post('/register', {
      slug: 'evil', siteName: 'E', siteUrl: 'https://example.com',
      openApiUrl: 'http://169.254.169.254/latest/meta-data/',
      apiUrl: 'https://example.com',
    }, AUTH);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/private|internal/i);
  });

  it('blocks localhost apiUrl', async () => {
    const res = await post('/register', {
      slug: 'sneaky', siteName: 'S', siteUrl: 'https://example.com',
      apiUrl: 'http://127.0.0.1:9200',
      openApiUrl: 'https://example.com/openapi.json',
    }, AUTH);
    expect(res.status).toBe(400);
  });
});

describe('sites list', () => {
  it('returns array with auth', async () => {
    const res = await get('/sites', AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });
});

describe('delete', () => {
  it('returns 404 for unknown slug', async () => {
    const res = await fetch(`${base}/sites/nonexistent`, {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(res.status).toBe(404);
  });
});

describe('single-char slug', () => {
  it('rejects single-char slugs (regex requires 2+)', async () => {
    const res = await post('/register', {
      slug: 'x', siteName: 'T', siteUrl: 'https://example.com', apiUrl: 'https://example.com',
    }, AUTH);
    expect(res.status).toBe(400);
  });
});

describe('ADMIN_API_KEY unset', () => {
  it('returns 503 when key is not configured', async () => {
    const saved = process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_API_KEY;
    try {
      const res = await get('/sites', AUTH);
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/not configured/i);
    } finally {
      process.env.ADMIN_API_KEY = saved;
    }
  });
});

// Keep this last — it exhausts the per-IP rate limit budget for all admin endpoints
describe('admin rate limiting', () => {
  it('returns 429 after too many requests', async () => {
    const promises = [];
    for (let i = 0; i < 25; i++) {
      promises.push(post('/register', { slug: 'rl' }, AUTH));
    }
    const results = await Promise.all(promises);
    const statuses = results.map(r => r.status);
    expect(statuses).toContain(429);
  });
});
