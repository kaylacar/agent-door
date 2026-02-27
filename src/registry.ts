import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { SiteRegistration } from './types';

export class Registry {
  private sites = new Map<string, SiteRegistration>();
  private filePath: string | null;

  constructor(filePath?: string) {
    this.filePath = filePath ?? null;
    if (this.filePath) this.load();
  }

  private load(): void {
    try {
      if (this.filePath && existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const entries: SiteRegistration[] = JSON.parse(raw);
        for (const entry of entries) {
          entry.createdAt = new Date(entry.createdAt);
          this.sites.set(entry.slug, entry);
        }
      }
    } catch {
      // Start fresh if file is corrupted
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify([...this.sites.values()], null, 2));
  }

  register(reg: SiteRegistration): void {
    this.sites.set(reg.slug, reg);
    this.persist();
  }

  get(slug: string): SiteRegistration | null {
    return this.sites.get(slug) ?? null;
  }

  list(): SiteRegistration[] {
    return [...this.sites.values()];
  }

  delete(slug: string): boolean {
    const result = this.sites.delete(slug);
    if (result) this.persist();
    return result;
  }
}
