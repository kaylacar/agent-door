import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SiteRegistration, SiteRegistrationWithSpec } from './types';

export class Registry {
  private db: Database.Database;
  private stmts: {
    insert: Database.Statement;
    getBySlug: Database.Statement;
    listAll: Database.Statement;
    listAllWithSpecs: Database.Statement;
    deleteBySlug: Database.Statement;
  };

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? process.env.DATABASE_PATH ?? './data/agent-door.db';
    if (resolvedPath !== ':memory:') {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS registrations (
        slug         TEXT PRIMARY KEY,
        site_name    TEXT NOT NULL,
        site_url     TEXT NOT NULL,
        api_url      TEXT NOT NULL,
        open_api_url TEXT,
        rate_limit   INTEGER NOT NULL DEFAULT 60,
        spec_json    TEXT NOT NULL,
        created_at   TEXT NOT NULL
      )
    `);
    this.stmts = {
      insert: this.db.prepare(`
        INSERT INTO registrations (slug, site_name, site_url, api_url, open_api_url, rate_limit, spec_json, created_at)
        VALUES (@slug, @siteName, @siteUrl, @apiUrl, @openApiUrl, @rateLimit, @specJson, @createdAt)
      `),
      getBySlug: this.db.prepare('SELECT slug, site_name, site_url, api_url, open_api_url, rate_limit, created_at FROM registrations WHERE slug = ?'),
      listAll: this.db.prepare('SELECT slug, site_name, site_url, api_url, open_api_url, rate_limit, created_at FROM registrations ORDER BY created_at'),
      listAllWithSpecs: this.db.prepare('SELECT * FROM registrations ORDER BY created_at'),
      deleteBySlug: this.db.prepare('DELETE FROM registrations WHERE slug = ?'),
    };
  }

  register(reg: SiteRegistration, specJson: string): void {
    this.stmts.insert.run({
      slug: reg.slug,
      siteName: reg.siteName,
      siteUrl: reg.siteUrl,
      apiUrl: reg.apiUrl,
      openApiUrl: reg.openApiUrl ?? null,
      rateLimit: reg.rateLimit,
      specJson,
      createdAt: reg.createdAt.toISOString(),
    });
  }

  get(slug: string): SiteRegistration | null {
    const row = this.stmts.getBySlug.get(slug) as Record<string, unknown> | undefined;
    return row ? this.rowToRegistration(row) : null;
  }

  list(): SiteRegistration[] {
    const rows = this.stmts.listAll.all() as Record<string, unknown>[];
    return rows.map(r => this.rowToRegistration(r));
  }

  listWithSpecs(): SiteRegistrationWithSpec[] {
    const rows = this.stmts.listAllWithSpecs.all() as Record<string, unknown>[];
    return rows.map(r => ({
      ...this.rowToRegistration(r),
      specJson: r.spec_json as string,
    }));
  }

  delete(slug: string): boolean {
    const result = this.stmts.deleteBySlug.run(slug);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }

  private rowToRegistration(row: Record<string, unknown>): SiteRegistration {
    return {
      slug: row.slug as string,
      siteName: row.site_name as string,
      siteUrl: row.site_url as string,
      apiUrl: row.api_url as string,
      openApiUrl: (row.open_api_url as string) ?? undefined,
      rateLimit: row.rate_limit as number,
      createdAt: new Date(row.created_at as string),
    };
  }
}
