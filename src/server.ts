import express, { Request, Response, NextFunction } from 'express';
import { AgentDoor } from '@agents-protocol/sdk';
import { Registry } from './registry';
import { SiteRegistration } from './types';
import { URL } from 'url';

const app = express();
app.use(express.json());

const registry = new Registry();
const doors = new Map<string, AgentDoor>();

const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL ?? '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';
const MAX_REGISTRATIONS = parseInt(process.env.MAX_REGISTRATIONS ?? '100', 10);
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? '10000', 10);

const RESERVED_SLUGS = new Set([
  'register', 'sites', 'admin', 'api', 'health', 'status', 'static', 'assets',
]);

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

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    return false;
  }

  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    return false;
  }

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0) return false;
  }

  return true;
}

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_KEY) {
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

function gatewayUrl(req: Request, slug: string): string {
  if (GATEWAY_BASE_URL) {
    return `${GATEWAY_BASE_URL.replace(/\/$/, '')}/${slug}`;
  }
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.get('host') ?? 'localhost';
  return `${proto}://${host}/${slug}`;
}

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Agent Door Gateway', version: '0.1.0' });
});

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
  if (RESERVED_SLUGS.has(slug)) {
    res.status(400).json({ ok: false, error: `Slug '${slug}' is reserved` });
    return;
  }
  if (doors.has(slug)) {
    res.status(409).json({ ok: false, error: `Slug '${slug}' is already registered` });
    return;
  }
  if (doors.size >= MAX_REGISTRATIONS) {
    res.status(503).json({ ok: false, error: 'Maximum number of registrations reached' });
    return;
  }

  const resolvedApiUrl = (typeof apiUrl === 'string' ? apiUrl : siteUrl).replace(/\/$/, '');
  const specUrl = typeof openApiUrl === 'string' ? openApiUrl : `${resolvedApiUrl}/openapi.json`;

  if (!isPublicUrl(specUrl)) {
    res.status(400).json({ ok: false, error: 'openApiUrl must be a public HTTP(S) URL' });
    return;
  }
  if (!isPublicUrl(resolvedApiUrl)) {
    res.status(400).json({ ok: false, error: 'apiUrl must be a public HTTP(S) URL' });
    return;
  }

  const resolvedRateLimit = typeof rateLimit === 'number' ? rateLimit : 60;
  const resolvedAudit = audit === true;

  let door: AgentDoor;
  try {
    const specRes = await fetch(specUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!specRes.ok) throw new Error(`HTTP ${specRes.status}`);
    const spec = await specRes.json();
    door = AgentDoor.fromOpenAPI(spec as unknown as Parameters<typeof AgentDoor.fromOpenAPI>[0], resolvedApiUrl, {
      site: { name: siteName, url: siteUrl },
      rateLimit: resolvedRateLimit,
      audit: resolvedAudit,
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
    rateLimit: resolvedRateLimit,
    audit: resolvedAudit,
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

app.get('/sites', requireAdminKey, (_req: Request, res: Response) => {
  const sites = registry.list().map(s => ({
    slug: s.slug,
    siteName: s.siteName,
    siteUrl: s.siteUrl,
    createdAt: s.createdAt,
  }));
  res.json({ ok: true, data: sites });
});

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

app.use('/:slug', (req, res, next) => {
  const { slug } = req.params;
  const door = doors.get(slug);
  if (!door) {
    res.status(404).json({ ok: false, error: `No agent door registered for '${slug}'` });
    return;
  }

  const original = req.url;
  const prefix = `/${slug}`;
  req.url = original.startsWith(prefix) ? original.substring(prefix.length) || '/' : original;

  door.middleware()(req, res, () => {
    req.url = original;
    next();
  });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Agent Door gateway running on port ${PORT}`);
});

export { app };
