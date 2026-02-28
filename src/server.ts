import express, { Request, Response, NextFunction } from 'express';
import { AgentDoor } from '@agents-protocol/sdk';
import { Registry } from './registry';
import { SiteRegistration } from './types';
import { validateExternalUrl } from './url-guard';

const app = express();
app.use(express.json({ limit: '1mb' }));

const registry = new Registry();
const doors = new Map<string, AgentDoor>();

const BASE_URL = (process.env.BASE_URL ?? 'https://agentdoor.io').replace(/\/$/, '');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY ?? '';

const RESERVED_SLUGS = new Set([
  'register', 'sites', 'health', 'admin', 'api', 'static', 'assets',
  'favicon.ico', 'robots.txt', '.well-known',
]);

// ─── Admin auth middleware ────────────────────────────────────────────────────

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!ADMIN_API_KEY) {
    // No key configured — reject all admin requests so the operator notices
    res.status(503).json({ ok: false, error: 'ADMIN_API_KEY not configured' });
    return;
  }
  const provided = req.headers['x-api-key'] ?? req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (provided !== ADMIN_API_KEY) {
    res.status(401).json({ ok: false, error: 'Invalid or missing API key' });
    return;
  }
  next();
}

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Agent Door Gateway', version: '0.1.0' });
});

// ─── Registration ─────────────────────────────────────────────────────────────

app.post('/register', requireAdminKey, async (req: Request, res: Response) => {
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
  if (RESERVED_SLUGS.has(slug)) {
    res.status(400).json({ ok: false, error: `Slug '${slug}' is reserved` });
    return;
  }
  if (doors.has(slug)) {
    res.status(409).json({ ok: false, error: `Slug '${slug}' is already registered` });
    return;
  }

  const resolvedApiUrl = (typeof apiUrl === 'string' ? apiUrl : siteUrl).replace(/\/$/, '');
  const specUrl = typeof openApiUrl === 'string' ? openApiUrl : `${resolvedApiUrl}/openapi.json`;

  // SSRF protection: validate both the spec URL and the API base URL
  try {
    await validateExternalUrl(specUrl);
    await validateExternalUrl(resolvedApiUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ ok: false, error: `URL validation failed: ${message}` });
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

  res.json({
    ok: true,
    data: {
      slug,
      gateway_url: `${BASE_URL}/${slug}`,
      agents_txt: `${BASE_URL}/${slug}/.well-known/agents.txt`,
      agents_json: `${BASE_URL}/${slug}/.well-known/agents.json`,
    },
  });
});

// ─── List registered sites ────────────────────────────────────────────────────

app.get('/sites', requireAdminKey, (_req, res) => {
  const sites = registry.list().map(s => ({
    slug: s.slug,
    siteName: s.siteName,
    siteUrl: s.siteUrl,
    gateway_url: `${BASE_URL}/${s.slug}`,
    createdAt: s.createdAt,
  }));
  res.json({ ok: true, data: sites });
});

// ─── Delete a registration ────────────────────────────────────────────────────

app.delete('/sites/:slug', requireAdminKey, (req, res) => {
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

  // Strip the slug prefix before passing to the door middleware
  const original = req.url;
  const prefix = `/${slug}`;
  req.url = original.startsWith(prefix) ? (original.slice(prefix.length) || '/') : original;

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
