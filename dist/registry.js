"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Registry = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = process.env.DATA_DIR ?? path_1.default.join(__dirname, '..', 'data');
const DB_PATH = path_1.default.join(DATA_DIR, 'sites.json');
class Registry {
    sites = new Map();
    constructor() {
        this.load();
    }
    load() {
        try {
            const raw = fs_1.default.readFileSync(DB_PATH, 'utf-8');
            const entries = JSON.parse(raw);
            for (const e of entries) {
                e.createdAt = new Date(e.createdAt);
                this.sites.set(e.slug, e);
            }
        }
        catch {
            // file doesn't exist yet, that's fine
        }
    }
    flush() {
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        fs_1.default.writeFileSync(DB_PATH, JSON.stringify([...this.sites.values()], null, 2));
    }
    register(reg) {
        this.sites.set(reg.slug, reg);
        this.flush();
    }
    get(slug) {
        return this.sites.get(slug);
    }
    list() {
        return [...this.sites.values()];
    }
    delete(slug) {
        const ok = this.sites.delete(slug);
        if (ok)
            this.flush();
        return ok;
    }
}
exports.Registry = Registry;
//# sourceMappingURL=registry.js.map