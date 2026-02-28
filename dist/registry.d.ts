import { SiteRegistration } from './types';
export declare class Registry {
    private sites;
    constructor();
    private load;
    private flush;
    register(reg: SiteRegistration): void;
    get(slug: string): SiteRegistration | undefined;
    list(): SiteRegistration[];
    delete(slug: string): boolean;
}
//# sourceMappingURL=registry.d.ts.map