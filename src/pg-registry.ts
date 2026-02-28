import { Pool } from 'pg';
import { SiteRegistration, IRegistry } from './types';

export class PgRegistry implements IRegistry {
  private pool: Pool;
  private ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        slug        TEXT PRIMARY KEY,
        site_name   TEXT NOT NULL,
        site_url    TEXT NOT NULL,
        api_url     TEXT NOT NULL,
        open_api_url TEXT,
        rate_limit  INTEGER NOT NULL DEFAULT 60,
        audit       BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  async register(reg: SiteRegistration): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO registrations (slug, site_name, site_url, api_url, open_api_url, rate_limit, audit, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         site_name = EXCLUDED.site_name,
         site_url = EXCLUDED.site_url,
         api_url = EXCLUDED.api_url,
         open_api_url = EXCLUDED.open_api_url,
         rate_limit = EXCLUDED.rate_limit,
         audit = EXCLUDED.audit`,
      [reg.slug, reg.siteName, reg.siteUrl, reg.apiUrl, reg.openApiUrl ?? null, reg.rateLimit, reg.audit, reg.createdAt],
    );
  }

  async get(slug: string): Promise<SiteRegistration | null> {
    await this.ready;
    const { rows } = await this.pool.query(
      'SELECT * FROM registrations WHERE slug = $1',
      [slug],
    );
    return rows.length > 0 ? this.toRegistration(rows[0]) : null;
  }

  async list(): Promise<SiteRegistration[]> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT * FROM registrations ORDER BY created_at');
    return rows.map(row => this.toRegistration(row));
  }

  async delete(slug: string): Promise<boolean> {
    await this.ready;
    const { rowCount } = await this.pool.query(
      'DELETE FROM registrations WHERE slug = $1',
      [slug],
    );
    return (rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private toRegistration(row: Record<string, unknown>): SiteRegistration {
    return {
      slug: row.slug as string,
      siteName: row.site_name as string,
      siteUrl: row.site_url as string,
      apiUrl: row.api_url as string,
      openApiUrl: (row.open_api_url as string) || undefined,
      rateLimit: row.rate_limit as number,
      audit: row.audit as boolean,
      createdAt: new Date(row.created_at as string),
    };
  }
}
