import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SiteRegistration } from '../src/types';

// ─── Mock pg ──────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => {
  return {
    Pool: class MockPool {
      query = mockQuery;
      end = mockEnd;
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sampleReg(overrides: Partial<SiteRegistration> = {}): SiteRegistration {
  return {
    slug: 'test-site',
    siteName: 'Test Site',
    siteUrl: 'https://test.com',
    apiUrl: 'https://api.test.com',
    rateLimit: 60,
    audit: false,
    createdAt: new Date('2025-06-01'),
    ...overrides,
  };
}

function dbRow(reg: SiteRegistration) {
  return {
    slug: reg.slug,
    site_name: reg.siteName,
    site_url: reg.siteUrl,
    api_url: reg.apiUrl,
    open_api_url: reg.openApiUrl ?? null,
    rate_limit: reg.rateLimit,
    audit: reg.audit,
    created_at: reg.createdAt.toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PgRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // init() CREATE TABLE call
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  async function createRegistry() {
    const { PgRegistry } = await import('../src/pg-registry');
    return new PgRegistry('postgresql://localhost/test');
  }

  it('creates the registrations table on init', async () => {
    await createRegistry();
    // Wait for init to complete
    await new Promise(r => setTimeout(r, 10));
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS registrations'));
  });

  it('registers a site with INSERT ... ON CONFLICT', async () => {
    const registry = await createRegistry();
    const reg = sampleReg();

    await registry.register(reg);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO registrations'),
      [reg.slug, reg.siteName, reg.siteUrl, reg.apiUrl, null, reg.rateLimit, reg.audit, reg.createdAt],
    );
  });

  it('gets a site by slug', async () => {
    const reg = sampleReg();
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // init
    const registry = await createRegistry();

    mockQuery.mockResolvedValueOnce({ rows: [dbRow(reg)], rowCount: 1 });
    const result = await registry.get('test-site');

    expect(result).not.toBeNull();
    expect(result!.slug).toBe('test-site');
    expect(result!.siteName).toBe('Test Site');
    expect(result!.createdAt).toEqual(new Date('2025-06-01'));
  });

  it('returns null for unknown slug', async () => {
    const registry = await createRegistry();

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await registry.get('no-such-site');

    expect(result).toBeNull();
  });

  it('lists all registrations ordered by created_at', async () => {
    const reg1 = sampleReg({ slug: 'site-a' });
    const reg2 = sampleReg({ slug: 'site-b' });

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // init
    const registry = await createRegistry();

    mockQuery.mockResolvedValueOnce({ rows: [dbRow(reg1), dbRow(reg2)], rowCount: 2 });
    const list = await registry.list();

    expect(list).toHaveLength(2);
    expect(list[0].slug).toBe('site-a');
    expect(list[1].slug).toBe('site-b');
  });

  it('deletes a registration and returns true', async () => {
    const registry = await createRegistry();

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const result = await registry.delete('test-site');

    expect(result).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM registrations WHERE slug'),
      ['test-site'],
    );
  });

  it('returns false when deleting non-existent slug', async () => {
    const registry = await createRegistry();

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await registry.delete('no-such-site');

    expect(result).toBe(false);
  });

  it('closes the pool', async () => {
    const registry = await createRegistry();
    await registry.close();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('handles openApiUrl in register and get', async () => {
    const reg = sampleReg({ openApiUrl: 'https://custom.com/spec.json' });

    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // init
    const registry = await createRegistry();

    await registry.register(reg);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT'),
      expect.arrayContaining(['https://custom.com/spec.json']),
    );

    mockQuery.mockResolvedValueOnce({ rows: [dbRow(reg)], rowCount: 1 });
    const result = await registry.get('test-site');
    expect(result!.openApiUrl).toBe('https://custom.com/spec.json');
  });
});
