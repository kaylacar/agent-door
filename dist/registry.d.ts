import { SiteRegistration } from './types';
export declare class Registry {
    private sites;
    register(reg: SiteRegistration): void;
    get(slug: string): SiteRegistration | null;
    list(): SiteRegistration[];
    delete(slug: string): boolean;
}
//# sourceMappingURL=registry.d.ts.map