import dns from 'node:dns/promises';
import net from 'node:net';
import express, { Request, Response, NextFunction } from 'express';
import { AgentDoor } from '@agents-protocol/sdk';
import { Registry } from './registry';
import { SiteRegistration } from './types';

const app = express();
app.use(express.json({ limit: '50kb' }));

const registry = new Registry();
const doors = new Map<string, AgentDoor>();

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
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized.startsWith('fe80:') || normalized.startsWith('fc00:') || normalized.startsWith('fd')) return true;
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
  // Resolve DNS to catch rebinding attacks
  try {
    const addresses = await dns.resolve4(parsed.hostname);
    return addresses.every(ip => !isPrivateIP(ip));
  } catch {
    return false;
  }
}

const FETCH_TIMEOUT_MS = 10_000;

// ─── Admin auth middleware ────────────────────────────────────────────────────

const ADMIN_KEY = process.env.ADMIN_KEY;

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_KEY) {
    // No key configured — admin endpoints are open (dev mode)
    next();
    return;
  }
  const provided = req.headers['x-admin-key'] ?? req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (provided !== ADMIN_KEY) {
    res.status(401).json({ ok: false, error: 'Invalid or missing admin key' });
    return;
  }
  next();
}

// ─── Gateway URL helper ──────────────────────────────────────────────────────

function gatewayBase(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.get('host') ?? 'localhost';
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
  const { slug, siteName, siteUrl, apiUrl, openApiUrl, rateLimit, audit } = req.body as Record<string, unknown>;

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
    const spec = await specRes.json();
    door = AgentDoor.fromOpenAPI(spec as unknown as Parameters<typeof AgentDoor.fromOpenAPI>[0], resolvedApiUrl, {
      site: { name: siteName, url: siteUrl },
      rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
      // Audit is disabled — the AuditManager is a stub with no real implementation.
      // Re-enable when a real audit backend is wired up.
      audit: false,
    });
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
    audit: false,
    createdAt: new Date(),
  };

  registry.register(reg);
  doors.set(slug, door);

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
  registry.delete(slug);
  res.json({ ok: true, data: { slug, deleted: true } });
});

// ─── Agent Door routing ───────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

app.use('/:slug', (req, res, next) => {
  const { slug } = req.params;
  const door = doors.get(slug);
  if (!door) {
    res.status(404).json({ ok: false, error: `No agent door registered for '${slug}'` });
    return;
  }

  // Strip the slug prefix before passing to the door middleware
  const original = req.url;
  req.url = original.replace(new RegExp(`^/${escapeRegExp(slug)}`), '') || '/';

  door.middleware()(req, res, () => {
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

export { app, startServer, isPublicUrl, resolveAndValidateUrl, isPrivateIP };
