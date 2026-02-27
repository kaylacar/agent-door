"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWindow = void 0;
exports.createApp = createApp;
exports.isPublicUrl = isPublicUrl;
exports.resolveAndValidateUrl = resolveAndValidateUrl;
exports.isPrivateIP = isPrivateIP;
exports.timingSafeEqual = timingSafeEqual;
exports.checkRegisterRate = checkRegisterRate;
const node_crypto_1 = __importDefault(require("node:crypto"));
const promises_1 = __importDefault(require("node:dns/promises"));
const node_net_1 = __importDefault(require("node:net"));
const express_1 = __importDefault(require("express"));
const sdk_1 = require("@agents-protocol/sdk");
const registry_1 = require("./registry");
const CORS_ORIGINS = process.env.CORS_ORIGINS; // comma-separated allowlist, or unset for '*'
const TRUSTED_PROXY = process.env.TRUSTED_PROXY; // e.g. 'loopback' or '10.0.0.0/8'
// ─── URL validation (SSRF protection) ────────────────────────────────────────
const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1', // URL.hostname strips brackets from IPv6
    'metadata.google.internal',
]);
const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|127\.)/;
function isPrivateIP(ip) {
    if (BLOCKED_HOSTNAMES.has(ip))
        return true;
    if (PRIVATE_IP_RE.test(ip))
        return true;
    if (ip === '0.0.0.0')
        return true;
    if (node_net_1.default.isIPv6(ip)) {
        const normalized = ip.toLowerCase();
        if (normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc00:') || normalized.startsWith('fd'))
            return true;
        // Block IPv6-mapped IPv4 addresses in dotted form (::ffff:127.0.0.1)
        const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (v4Mapped && isPrivateIP(v4Mapped[1]))
            return true;
        // Block IPv6-mapped IPv4 in hex form (::ffff:7f00:1 = 127.0.0.1)
        // URL parsers normalize ::ffff:A.B.C.D to ::ffff:XXYY:ZZWW hex
        const v4HexMapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (v4HexMapped) {
            const high = parseInt(v4HexMapped[1], 16);
            const low = parseInt(v4HexMapped[2], 16);
            const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
            if (isPrivateIP(ipv4))
                return true;
        }
    }
    return false;
}
function isPublicUrl(raw) {
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        return false;
    // URL.hostname wraps IPv6 in brackets (e.g. '[::1]'); strip them for IP checks.
    const hostname = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
        ? parsed.hostname.slice(1, -1)
        : parsed.hostname;
    if (isPrivateIP(hostname))
        return false;
    return true;
}
async function resolveAndValidateUrl(raw) {
    let parsed;
    try {
        parsed = new URL(raw);
    }
    catch {
        return false;
    }
    if (!isPublicUrl(raw))
        return false;
    // If it's already an IP, check directly
    if (node_net_1.default.isIP(parsed.hostname))
        return !isPrivateIP(parsed.hostname);
    // Resolve DNS (both A and AAAA) to catch rebinding attacks
    try {
        const [v4, v6] = await Promise.all([
            promises_1.default.resolve4(parsed.hostname).catch(() => []),
            promises_1.default.resolve6(parsed.hostname).catch(() => []),
        ]);
        const all = [...v4, ...v6];
        if (all.length === 0)
            return false; // unresolvable hostname
        return all.every(ip => !isPrivateIP(ip));
    }
    catch {
        return false;
    }
}
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SPEC_BYTES = 5 * 1024 * 1024; // 5 MB cap on OpenAPI spec response
const MAX_SPEC_PATHS = 100; // cap on number of OpenAPI paths to prevent resource exhaustion
const MAX_REGISTRATIONS = 500; // hard cap on total registered sites
// ─── Admin auth middleware ────────────────────────────────────────────────────
const ADMIN_KEY = process.env.ADMIN_KEY || undefined; // treat '' as unset
function timingSafeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        // Compare against self so timing doesn't reveal length difference
        node_crypto_1.default.timingSafeEqual(bufA, bufA);
        return false;
    }
    return node_crypto_1.default.timingSafeEqual(bufA, bufB);
}
function requireAdmin(req, res, next) {
    if (!ADMIN_KEY) {
        // No key configured — admin endpoints are open (dev mode)
        next();
        return;
    }
    const provided = req.headers['x-admin-key'] ?? req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    if (typeof provided !== 'string' || !timingSafeEqual(provided, ADMIN_KEY)) {
        res.status(401).json({ ok: false, error: 'Invalid or missing admin key' });
        return;
    }
    next();
}
// ─── Gateway URL helper ──────────────────────────────────────────────────────
function gatewayBase(req) {
    // Only trust x-forwarded-* headers when trust proxy is configured.
    // Express populates req.protocol from x-forwarded-proto only when trusted.
    const proto = req.protocol; // respects 'trust proxy' setting
    const host = req.get('host') ?? 'localhost'; // respects 'trust proxy' setting
    return `${proto}://${host}`;
}
// ─── Registration rate limiting ───────────────────────────────────────────────
const registerWindow = new Map();
exports.registerWindow = registerWindow;
const REGISTER_LIMIT = 10; // max registrations per IP per window
const REGISTER_WINDOW_MS = 60_000;
// Periodic cleanup to prevent unbounded memory growth from stale IPs
const registerCleanupInterval = setInterval(() => {
    const cutoff = Date.now() - REGISTER_WINDOW_MS;
    for (const [ip, timestamps] of registerWindow) {
        const recent = timestamps.filter(t => t > cutoff);
        if (recent.length === 0) {
            registerWindow.delete(ip);
        }
        else {
            registerWindow.set(ip, recent);
        }
    }
}, 30_000);
registerCleanupInterval.unref(); // don't prevent process exit
function checkRegisterRate(ip) {
    const now = Date.now();
    const cutoff = now - REGISTER_WINDOW_MS;
    let timestamps = registerWindow.get(ip);
    if (!timestamps) {
        timestamps = [];
        registerWindow.set(ip, timestamps);
    }
    const recent = timestamps.filter(t => t > cutoff);
    registerWindow.set(ip, recent);
    if (recent.length >= REGISTER_LIMIT)
        return false;
    recent.push(now);
    return true;
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function rebuildDoors(registry, doors, doorMiddlewares, slugPatterns) {
    const stored = registry.listWithSpecs();
    let loaded = 0;
    const failed = [];
    for (const row of stored) {
        try {
            const spec = JSON.parse(row.specJson);
            if (!spec?.paths || typeof spec.paths !== 'object') {
                throw new Error('Invalid spec structure');
            }
            const door = sdk_1.AgentDoor.fromOpenAPI(spec, row.apiUrl, {
                site: { name: row.siteName, url: row.siteUrl },
                rateLimit: row.rateLimit,
                audit: false,
                corsOrigin: CORS_ORIGINS ? CORS_ORIGINS.split(',').map(s => s.trim()) : '*',
            });
            doors.set(row.slug, door);
            doorMiddlewares.set(row.slug, door.middleware());
            slugPatterns.set(row.slug, new RegExp(`^/${escapeRegExp(row.slug)}`));
            loaded++;
        }
        catch (err) {
            console.error(`Failed to rebuild door for '${row.slug}':`, err);
            failed.push(row.slug);
        }
    }
    if (loaded > 0 || failed.length > 0) {
        console.log(`Rebuilt ${loaded} door(s) from database` +
            (failed.length > 0 ? ` (${failed.length} failed: ${failed.join(', ')})` : ''));
    }
}
function createApp(options = {}) {
    const registry = new registry_1.Registry(options.dbPath);
    const doors = new Map();
    const doorMiddlewares = new Map();
    const slugPatterns = new Map();
    const app = (0, express_1.default)();
    if (TRUSTED_PROXY) {
        app.set('trust proxy', TRUSTED_PROXY);
    }
    app.use(express_1.default.json({ limit: '50kb' }));
    // Rebuild persisted doors
    rebuildDoors(registry, doors, doorMiddlewares, slugPatterns);
    // ─── Health check ───────────────────────────────────────────────────────────
    app.get('/', (_req, res) => {
        res.json({ ok: true, service: 'Agent Door Gateway', version: '0.1.0' });
    });
    // ─── Registration ───────────────────────────────────────────────────────────
    app.post('/register', requireAdmin, async (req, res) => {
        if (!checkRegisterRate(req.ip ?? req.socket?.remoteAddress ?? 'unknown')) {
            res.set('Retry-After', '60').status(429).json({ ok: false, error: 'Too many registration attempts. Try again later.' });
            return;
        }
        const { slug, siteName, siteUrl, apiUrl, openApiUrl, rateLimit } = req.body;
        if (typeof slug !== 'string' || typeof siteName !== 'string' || typeof siteUrl !== 'string') {
            res.status(400).json({ ok: false, error: 'Missing required fields: slug, siteName, siteUrl' });
            return;
        }
        if (typeof apiUrl !== 'string' && typeof openApiUrl !== 'string') {
            res.status(400).json({ ok: false, error: 'Provide apiUrl or openApiUrl' });
            return;
        }
        if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
            res.status(400).json({ ok: false, error: 'slug must be 2-40 lowercase letters, numbers, or hyphens' });
            return;
        }
        if (typeof rateLimit !== 'undefined' && (typeof rateLimit !== 'number' || !Number.isFinite(rateLimit) || rateLimit < 1 || rateLimit > 1000)) {
            res.status(400).json({ ok: false, error: 'rateLimit must be a number between 1 and 1000' });
            return;
        }
        if (doors.size >= MAX_REGISTRATIONS) {
            res.status(503).json({ ok: false, error: 'Maximum number of registrations reached' });
            return;
        }
        if (doors.has(slug)) {
            res.status(409).json({ ok: false, error: `Slug '${slug}' is already registered` });
            return;
        }
        // Validate URLs against SSRF (with DNS resolution to prevent rebinding)
        const urlsToCheck = [siteUrl, ...(typeof apiUrl === 'string' ? [apiUrl] : []), ...(typeof openApiUrl === 'string' ? [openApiUrl] : [])];
        for (const u of urlsToCheck) {
            if (!(await resolveAndValidateUrl(u))) {
                res.status(400).json({ ok: false, error: `URL not allowed: ${u}` });
                return;
            }
        }
        const resolvedApiUrl = (typeof apiUrl === 'string' ? apiUrl : siteUrl).replace(/\/$/, '');
        const specUrl = typeof openApiUrl === 'string' ? openApiUrl : `${resolvedApiUrl}/openapi.json`;
        if (!(await resolveAndValidateUrl(specUrl))) {
            res.status(400).json({ ok: false, error: `Spec URL not allowed: ${specUrl}` });
            return;
        }
        let door;
        let specText;
        try {
            const specRes = await fetch(specUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!specRes.ok)
                throw new Error(`HTTP ${specRes.status} fetching spec`);
            const contentLength = specRes.headers.get('content-length');
            if (contentLength && parseInt(contentLength, 10) > MAX_SPEC_BYTES) {
                throw new Error(`Spec exceeds ${MAX_SPEC_BYTES} byte limit`);
            }
            specText = await specRes.text();
            if (specText.length > MAX_SPEC_BYTES)
                throw new Error(`Spec exceeds ${MAX_SPEC_BYTES} byte limit`);
            const spec = JSON.parse(specText);
            // Validate spec structure before creating capabilities
            if (!spec || typeof spec !== 'object' || !spec.paths || typeof spec.paths !== 'object' || Array.isArray(spec.paths)) {
                throw new Error('Invalid OpenAPI spec: missing or malformed "paths" object');
            }
            const pathCount = Object.keys(spec.paths).length;
            if (pathCount === 0)
                throw new Error('OpenAPI spec has no paths');
            if (pathCount > MAX_SPEC_PATHS)
                throw new Error(`OpenAPI spec has ${pathCount} paths, max is ${MAX_SPEC_PATHS}`);
            door = sdk_1.AgentDoor.fromOpenAPI(spec, resolvedApiUrl, {
                site: { name: siteName, url: siteUrl },
                rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
                audit: false,
                corsOrigin: CORS_ORIGINS ? CORS_ORIGINS.split(',').map(s => s.trim()) : '*',
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // Sanitize: only expose safe error details, not internal DNS/network info
            const safeMessage = message.startsWith('Invalid OpenAPI spec') || message.startsWith('OpenAPI spec has')
                ? message
                : message.startsWith('HTTP ') || message.startsWith('Spec exceeds')
                    ? message
                    : 'Failed to fetch or parse spec';
            res.status(400).json({ ok: false, error: `Could not load OpenAPI spec: ${safeMessage}` });
            return;
        }
        const reg = {
            slug,
            siteName,
            siteUrl,
            apiUrl: resolvedApiUrl,
            openApiUrl: typeof openApiUrl === 'string' ? openApiUrl : undefined,
            rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
            createdAt: new Date(),
        };
        registry.register(reg, specText);
        doors.set(slug, door);
        doorMiddlewares.set(slug, door.middleware());
        slugPatterns.set(slug, new RegExp(`^/${escapeRegExp(slug)}`));
        const base = gatewayBase(req);
        res.json({
            ok: true,
            data: {
                slug,
                gateway_url: `${base}/${slug}`,
                agents_txt: `${base}/${slug}/.well-known/agents.txt`,
                agents_json: `${base}/${slug}/.well-known/agents.json`,
            },
        });
    });
    // ─── List registered sites ──────────────────────────────────────────────────
    app.get('/sites', requireAdmin, (_req, res) => {
        const base = gatewayBase(_req);
        const sites = registry.list().map(s => ({
            slug: s.slug,
            siteName: s.siteName,
            siteUrl: s.siteUrl,
            gateway_url: `${base}/${s.slug}`,
            createdAt: s.createdAt,
        }));
        res.json({ ok: true, data: sites });
    });
    // ─── Delete a registration ──────────────────────────────────────────────────
    app.delete('/sites/:slug', requireAdmin, (req, res) => {
        const { slug } = req.params;
        const door = doors.get(slug);
        if (!door) {
            res.status(404).json({ ok: false, error: `No site registered for '${slug}'` });
            return;
        }
        door.destroy();
        doors.delete(slug);
        doorMiddlewares.delete(slug);
        slugPatterns.delete(slug);
        registry.delete(slug);
        res.json({ ok: true, data: { slug, deleted: true } });
    });
    // ─── Agent Door routing ─────────────────────────────────────────────────────
    app.use('/:slug', (req, res, next) => {
        const { slug } = req.params;
        const mw = doorMiddlewares.get(slug);
        if (!mw) {
            res.status(404).json({ ok: false, error: `No agent door registered for '${slug}'` });
            return;
        }
        // Strip the slug prefix before passing to the door middleware
        const original = req.url;
        const pattern = slugPatterns.get(slug);
        req.url = original.replace(pattern, '') || '/';
        mw(req, res, () => {
            // Restore URL if the door didn't handle it
            req.url = original;
            next();
        });
    });
    // ─── Start ──────────────────────────────────────────────────────────────────
    function startServer() {
        const PORT = parseInt(process.env.PORT ?? '3000', 10);
        const server = app.listen(PORT, () => {
            console.log(`Agent Door gateway running on port ${PORT}`);
            console.log(`Register a site: POST http://localhost:${PORT}/register`);
            if (!ADMIN_KEY) {
                console.log('WARNING: No ADMIN_KEY set — admin endpoints are unprotected');
            }
        });
        // ─── Graceful shutdown ────────────────────────────────────────────────────
        function shutdown() {
            console.log('Shutting down...');
            for (const [, door] of doors) {
                door.destroy();
            }
            doors.clear();
            doorMiddlewares.clear();
            registry.close();
            server.close(() => {
                process.exit(0);
            });
        }
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
        return server;
    }
    return { app, registry, startServer };
}
// Auto-start when run directly (not imported for tests)
if (require.main === module) {
    const { startServer } = createApp();
    startServer();
}
//# sourceMappingURL=server.js.map