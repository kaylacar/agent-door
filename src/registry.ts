import { SiteRegistration } from './types';

export class Registry {
  private sites = new Map<string, SiteRegistration>();

  register(reg: SiteRegistration): void {
    this.sites.set(reg.slug, reg);
  }

  get(slug: string): SiteRegistration | null {
    return this.sites.get(slug) ?? null;
  }

  list(): SiteRegistration[] {
    return [...this.sites.values()];
  }

  delete(slug: string): boolean {
    return this.sites.delete(slug);
  }
}
