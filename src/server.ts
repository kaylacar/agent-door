import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import express, { Request, Response, NextFunction } from 'express';
import { AgentDoor } from '@agents-protocol/sdk';
import { Registry } from './registry';
import { SiteRegistration } from './types';

const CORS_ORIGINS = process.env.CORS_ORIGINS; // comma-separated allowlist, or unset for '*'
const TRUSTED_PROXY = process.env.TRUSTED_PROXY; // e.g. 'loopback' or '10.0.0.0/8'

const app = express();
if (TRUSTED_PROXY) {
  app.set('trust proxy', TRUSTED_PROXY);
}
app.use(express.json({ limit: '50kb' }));

const registry = new Registry();
const doors = new Map<string, AgentDoor>();
const doorMiddlewares = new Map<string, ReturnType<AgentDoor['middleware']>>();
const slugPatterns = new Map<string, RegExp>();

// ─── URL validation (SSRF protection) ────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  'metadata.google.internal',
]);

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|127\.)/;

function isPrivateIP(ip: string): boolean {
  if (BLOCKED_HOSTNAMES.has(ip)) return true;
  if (PRIVATE_IP_RE.test(ip)) return true;
  if (ip === '0.0.0.0') return true;
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc00:') || normalized.startsWith('fd')) return true;
    // Block IPv6-mapped IPv4 addresses (::ffff:127.0.0.1)
    const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4Mapped && isPrivateIP(v4Mapped[1])) return true;
  }
  return false;
}

function isPublicUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (BLOCKED_HOSTNAMES.has(parsed.hostname)) return false;
  if (PRIVATE_IP_RE.test(parsed.hostname)) return false;
  return true;
}

async function resolveAndValidateUrl(raw: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!isPublicUrl(raw)) return false;
  // If it's already an IP, check directly
  if (net.isIP(parsed.hostname)) return !isPrivateIP(parsed.hostname);
  // Resolve DNS (both A and AAAA) to catch rebinding attacks
  try {
    const [v4, v6] = await Promise.all([
      dns.resolve4(parsed.hostname).catch(() => [] as string[]),
      dns.resolve6(parsed.hostname).catch(() => [] as string[]),
    ]);
    const all = [...v4, ...v6];
    if (all.length === 0) return false; // unresolvable hostname
    return all.every(ip => !isPrivateIP(ip));
  } catch {
    return false;
  }
}

const FETCH_TIMEOUT_MS = 10_000;
const MAX_SPEC_BYTES = 5 * 1024 * 1024; // 5 MB cap on OpenAPI spec response

// ─── Admin auth middleware ────────────────────────────────────────────────────

const ADMIN_KEY = process.env.ADMIN_KEY;

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self so timing doesn't reveal length difference
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
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

function gatewayBase(req: Request): string {
  // Only trust x-forwarded-* headers when trust proxy is configured.
  // Express populates req.protocol from x-forwarded-proto only when trusted.
  const proto = req.protocol; // respects 'trust proxy' setting
  const host = req.get('host') ?? 'localhost'; // respects 'trust proxy' setting
  return `${proto}://${host}`;
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Agent Door Gateway', version: '0.1.0' });
});

// ─── Registration rate limiting ───────────────────────────────────────────────

const registerWindow = new Map<string, number[]>();
const REGISTER_LIMIT = 10; // max registrations per IP per window
const REGISTER_WINDOW_MS = 60_000;

// Periodic cleanup to prevent unbounded memory growth from stale IPs
const registerCleanupInterval = setInterval(() => {
  const cutoff = Date.now() - REGISTER_WINDOW_MS;
  for (const [ip, timestamps] of registerWindow) {
    const recent = timestamps.filter(t => t > cutoff);
    if (recent.length === 0) {
      registerWindow.delete(ip);
    } else {
      registerWindow.set(ip, recent);
    }
  }
}, 30_000);
registerCleanupInterval.unref(); // don't prevent process exit

function checkRegisterRate(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - REGISTER_WINDOW_MS;
  let timestamps = registerWindow.get(ip);
  if (!timestamps) {
    timestamps = [];
    registerWindow.set(ip, timestamps);
  }
  const recent = timestamps.filter(t => t > cutoff);
  registerWindow.set(ip, recent);
  if (recent.length >= REGISTER_LIMIT) return false;
  recent.push(now);
  return true;
}

// ─── Registration ─────────────────────────────────────────────────────────────

app.post('/register', requireAdmin, async (req: Request, res: Response) => {
  if (!checkRegisterRate(req.ip ?? req.socket?.remoteAddress ?? 'unknown')) {
    res.status(429).json({ ok: false, error: 'Too many registration attempts. Try again later.' });
    return;
  }
  const { slug, siteName, siteUrl, apiUrl, openApiUrl, rateLimit } = req.body as Record<string, unknown>;

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

  let door: AgentDoor;
  try {
    const specRes = await fetch(specUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!specRes.ok) throw new Error(`HTTP ${specRes.status} fetching spec`);
    const specText = await specRes.text();
    if (specText.length > MAX_SPEC_BYTES) throw new Error(`Spec exceeds ${MAX_SPEC_BYTES} byte limit`);
    const spec = JSON.parse(specText);
    door = AgentDoor.fromOpenAPI(spec as unknown as Parameters<typeof AgentDoor.fromOpenAPI>[0], resolvedApiUrl, {
      site: { name: siteName, url: siteUrl },
      rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
      audit: false,
      corsOrigin: CORS_ORIGINS ? CORS_ORIGINS.split(',').map(s => s.trim()) : '*',
    } as Record<string, unknown>);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, error: `Could not load OpenAPI spec from ${specUrl}: ${message}` });
    return;
  }

  const reg: SiteRegistration = {
    slug,
    siteName,
    siteUrl,
    apiUrl: resolvedApiUrl,
    openApiUrl: typeof openApiUrl === 'string' ? openApiUrl : undefined,
    rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
    createdAt: new Date(),
  };

  registry.register(reg);
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

// ─── List registered sites ────────────────────────────────────────────────────

app.get('/sites', requireAdmin, (_req: Request, res: Response) => {
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

// ─── Delete a registration ────────────────────────────────────────────────────

app.delete('/sites/:slug', requireAdmin, (req: Request, res: Response) => {
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

// ─── Agent Door routing ───────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.use('/:slug', (req, res, next) => {
  const { slug } = req.params;
  const mw = doorMiddlewares.get(slug);
  if (!mw) {
    res.status(404).json({ ok: false, error: `No agent door registered for '${slug}'` });
    return;
  }

  // Strip the slug prefix before passing to the door middleware
  const original = req.url;
  const pattern = slugPatterns.get(slug)!;
  req.url = original.replace(pattern, '') || '/';

  mw(req, res, () => {
    // Restore URL if the door didn't handle it
    req.url = original;
    next();
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

function startServer() {
  const PORT = parseInt(process.env.PORT ?? '3000', 10);
  const server = app.listen(PORT, () => {
    console.log(`Agent Door gateway running on port ${PORT}`);
    console.log(`Register a site: POST http://localhost:${PORT}/register`);
    if (!ADMIN_KEY) {
      console.log('WARNING: No ADMIN_KEY set — admin endpoints are unprotected');
    }
  });

  // ─── Graceful shutdown ──────────────────────────────────────────────────────

  function shutdown() {
    console.log('Shutting down...');
    for (const [, door] of doors) {
      door.destroy();
    }
    doors.clear();
    doorMiddlewares.clear();
    server.close(() => {
      process.exit(0);
    });
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return server;
}

// Auto-start when run directly (not imported for tests)
if (require.main === module) {
  startServer();
}

export { app, startServer, isPublicUrl, resolveAndValidateUrl, isPrivateIP, timingSafeEqual, checkRegisterRate, registerWindow };
