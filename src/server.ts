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

function isPublicUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (BLOCKED_HOSTNAMES.has(parsed.hostname)) return false;
  // Block link-local, loopback, and AWS metadata IPs
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|127\.)/.test(parsed.hostname)) return false;
  return true;
}

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

// ─── Registration ─────────────────────────────────────────────────────────────

app.post('/register', requireAdmin, async (req: Request, res: Response) => {
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

  // Validate URLs against SSRF
  const urlsToCheck = [siteUrl, ...(typeof apiUrl === 'string' ? [apiUrl] : []), ...(typeof openApiUrl === 'string' ? [openApiUrl] : [])];
  for (const u of urlsToCheck) {
    if (!isPublicUrl(u)) {
      res.status(400).json({ ok: false, error: `URL not allowed: ${u}` });
      return;
    }
  }

  const resolvedApiUrl = (typeof apiUrl === 'string' ? apiUrl : siteUrl).replace(/\/$/, '');
  const specUrl = typeof openApiUrl === 'string' ? openApiUrl : `${resolvedApiUrl}/openapi.json`;

  if (!isPublicUrl(specUrl)) {
    res.status(400).json({ ok: false, error: `Spec URL not allowed: ${specUrl}` });
    return;
  }

  let door: AgentDoor;
  try {
    const specRes = await fetch(specUrl);
    if (!specRes.ok) throw new Error(`HTTP ${specRes.status} fetching spec`);
    const spec = await specRes.json();
    door = AgentDoor.fromOpenAPI(spec as unknown as Parameters<typeof AgentDoor.fromOpenAPI>[0], resolvedApiUrl, {
      site: { name: siteName, url: siteUrl },
      rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
      audit: audit === true,
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
    audit: audit === true,
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

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const server = app.listen(PORT, () => {
  console.log(`Agent Door gateway running on port ${PORT}`);
  console.log(`Register a site: POST http://localhost:${PORT}/register`);
  if (!ADMIN_KEY) {
    console.log('WARNING: No ADMIN_KEY set — admin endpoints are unprotected');
  }
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown() {
  console.log('Shutting down...');
  for (const [slug, door] of doors) {
    door.destroy();
    doors.delete(slug);
  }
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app };
