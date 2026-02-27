"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registry = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
class Registry {
    db;
    stmts;
    constructor(dbPath) {
        const resolvedPath = dbPath ?? process.env.DATABASE_PATH ?? './data/agent-door.db';
        if (resolvedPath !== ':memory:') {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(resolvedPath), { recursive: true });
        }
        this.db = new better_sqlite3_1.default(resolvedPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('busy_timeout = 5000');
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
    register(reg, specJson) {
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
    get(slug) {
        const row = this.stmts.getBySlug.get(slug);
        return row ? this.rowToRegistration(row) : null;
    }
    list() {
        const rows = this.stmts.listAll.all();
        return rows.map(r => this.rowToRegistration(r));
    }
    listWithSpecs() {
        const rows = this.stmts.listAllWithSpecs.all();
        return rows.map(r => ({
            ...this.rowToRegistration(r),
            specJson: r.spec_json,
        }));
    }
    delete(slug) {
        const result = this.stmts.deleteBySlug.run(slug);
        return result.changes > 0;
    }
    healthy() {
        try {
            this.db.prepare('SELECT 1').get();
            return true;
        }
        catch {
            return false;
        }
    }
    close() {
        try {
            this.db.pragma('wal_checkpoint(TRUNCATE)');
        }
        catch { /* best-effort flush before close */ }
        this.db.close();
    }
    rowToRegistration(row) {
        return {
            slug: row.slug,
            siteName: row.site_name,
            siteUrl: row.site_url,
            apiUrl: row.api_url,
            openApiUrl: row.open_api_url ?? undefined,
            rateLimit: row.rate_limit,
            createdAt: new Date(row.created_at),
        };
    }
}
exports.Registry = Registry;
//# sourceMappingURL=registry.js.map