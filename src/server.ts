import express, { Request, Response, NextFunction } from 'express';
import { AgentDoor } from '@agents-protocol/sdk';
import { Registry } from './registry';
import { SiteRegistration } from './types';
import { URL } from 'url';

const app = express();
app.use(express.json());

const registry = new Registry();
const doors = new Map<string, AgentDoor>();

// ─── Config ──────────────────────────────────────────────────────────────────

const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL ?? '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';
const MAX_REGISTRATIONS = parseInt(process.env.MAX_REGISTRATIONS ?? '100', 10);

// ─── SSRF protection ─────────────────────────────────────────────────────────

function isPublicUrl(input: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    return false;
  }

  // Block link-local / metadata (AWS, GCP, Azure)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return false;
  }

  // Block private RFC-1918 ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return false;                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false;   // 172.16.0.0/12
    if (a === 192 && b === 168) return false;             // 192.168.0.0/16
    if (a === 0) return false;                            // 0.0.0.0/8
  }

  return true;
}

// ─── Admin auth middleware ────────────────────────────────────────────────────

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_KEY) {
    // No key configured — allow (development mode)
    next();
    return;
  }
  const provided = req.headers['x-api-key'] ?? req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (provided !== ADMIN_API_KEY) {
    res.status(401).json({ ok: false, error: 'Invalid or missing API key' });
    return;
  }
  next();
}

// ─── Gateway URL helper ──────────────────────────────────────────────────────

function gatewayUrl(req: Request, slug: string): string {
  if (GATEWAY_BASE_URL) {
    return `${GATEWAY_BASE_URL.replace(/\/$/, '')}/${slug}`;
  }
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.get('host') ?? 'localhost';
  return `${proto}://${host}/${slug}`;
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Agent Door Gateway', version: '0.1.0' });
});

// ─── Registration ─────────────────────────────────────────────────────────────

app.post('/register', requireAdminKey, async (req: Request, res: Response) => {
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

  // Bound memory: limit total registrations
  if (doors.size >= MAX_REGISTRATIONS) {
    res.status(503).json({ ok: false, error: 'Maximum number of registrations reached' });
    return;
  }

  const resolvedApiUrl = (typeof apiUrl === 'string' ? apiUrl : siteUrl).replace(/\/$/, '');
  const specUrl = typeof openApiUrl === 'string' ? openApiUrl : `${resolvedApiUrl}/openapi.json`;

  // SSRF protection: validate both URLs resolve to public addresses
  if (!isPublicUrl(specUrl)) {
    res.status(400).json({ ok: false, error: 'openApiUrl must be a public HTTP(S) URL' });
    return;
  }
  if (!isPublicUrl(resolvedApiUrl)) {
    res.status(400).json({ ok: false, error: 'apiUrl must be a public HTTP(S) URL' });
    return;
  }

  let door: AgentDoor;
  try {
    const specRes = await fetch(specUrl);
    if (!specRes.ok) throw new Error(`HTTP ${specRes.status}`);
    const spec = await specRes.json();
    door = AgentDoor.fromOpenAPI(spec as unknown as Parameters<typeof AgentDoor.fromOpenAPI>[0], resolvedApiUrl, {
      site: { name: siteName, url: siteUrl },
      rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
      audit: audit === true,
    });
  } catch {
    res.status(400).json({ ok: false, error: 'Could not load OpenAPI spec from the provided URL' });
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

  const base = gatewayUrl(req, slug);
  res.json({
    ok: true,
    data: {
      slug,
      gateway_url: base,
      agents_txt: `${base}/.well-known/agents.txt`,
      agents_json: `${base}/.well-known/agents.json`,
    },
  });
});

// ─── List registered sites ────────────────────────────────────────────────────

app.get('/sites', requireAdminKey, (_req: Request, res: Response) => {
  const sites = registry.list().map(s => ({
    slug: s.slug,
    siteName: s.siteName,
    siteUrl: s.siteUrl,
    createdAt: s.createdAt,
  }));
  res.json({ ok: true, data: sites });
});

// ─── Delete a registration ────────────────────────────────────────────────────

app.delete('/sites/:slug', requireAdminKey, (req: Request, res: Response) => {
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

app.use('/:slug', (req, res, next) => {
  const { slug } = req.params;
  const door = doors.get(slug);
  if (!door) {
    res.status(404).json({ ok: false, error: `No agent door registered for '${slug}'` });
    return;
  }

  // Strip the slug prefix using substring instead of regex
  const original = req.url;
  const prefix = `/${slug}`;
  req.url = original.startsWith(prefix) ? original.substring(prefix.length) || '/' : original;

  door.middleware()(req, res, () => {
    // Restore URL if the door didn't handle it
    req.url = original;
    next();
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Agent Door gateway running on port ${PORT}`);
  console.log(`Register a site: POST http://localhost:${PORT}/register`);
});

export { app };
