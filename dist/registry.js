"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registry = void 0;
class Registry {
    sites = new Map();
    register(reg) {
        this.sites.set(reg.slug, reg);
    }
    get(slug) {
        return this.sites.get(slug) ?? null;
    }
    list() {
        return [...this.sites.values()];
    }
    delete(slug) {
        return this.sites.delete(slug);
    }
}
exports.Registry = Registry;
//# sourceMappingURL=registry.js.map