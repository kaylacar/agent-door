import { SiteRegistration, SiteRegistrationWithSpec } from './types';
export declare class Registry {
    private db;
    private stmts;
    constructor(dbPath?: string);
    register(reg: SiteRegistration, specJson: string): void;
    get(slug: string): SiteRegistration | null;
    list(): SiteRegistration[];
    listWithSpecs(): SiteRegistrationWithSpec[];
    delete(slug: string): boolean;
    close(): void;
    private rowToRegistration;
}
//# sourceMappingURL=registry.d.ts.map