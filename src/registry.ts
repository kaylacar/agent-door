import fs from 'fs';
import path from 'path';
import { SiteRegistration } from './types';

const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'sites.json');

export class Registry {
  private sites = new Map<string, SiteRegistration>();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const entries: SiteRegistration[] = JSON.parse(raw);
      for (const e of entries) {
        e.createdAt = new Date(e.createdAt);
        this.sites.set(e.slug, e);
      }
    } catch {
      // file doesn't exist yet, that's fine
    }
  }

  private flush() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify([...this.sites.values()], null, 2));
  }

  register(reg: SiteRegistration) {
    this.sites.set(reg.slug, reg);
    this.flush();
  }

  get(slug: string): SiteRegistration | undefined {
    return this.sites.get(slug);
  }

  list(): SiteRegistration[] {
    return [...this.sites.values()];
  }

  delete(slug: string): boolean {
    const ok = this.sites.delete(slug);
    if (ok) this.flush();
    return ok;
  }
}
