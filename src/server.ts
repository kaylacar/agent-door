import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AgentDoor } from '@agents-protocol/sdk';
import { Registry } from './registry';
import { SiteRegistration } from './types';
import { validateExternalUrl } from './url-guard';

const app = express();
app.use(express.json({ limit: '1mb' }));

const registry = new Registry();
const doors = new Map<string, AgentDoor>();

function baseUrl() {
  return (process.env.BASE_URL ?? 'https://agentdoor.io').replace(/\/$/, '');
}

// slugs that would shadow actual routes
const RESERVED_SLUGS = new Set([
  'register', 'sites', 'health', 'admin', 'api',
  'static', 'assets', 'favicon.ico', 'robots.txt', '.well-known',
]);

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'ADMIN_API_KEY not configured' });
    return;
  }
  const provided = req.headers['x-api-key']
    ?? req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  if (typeof provided !== 'string'
    || provided.length !== key.length
    || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(key))) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }
  next();
}

app.get('/', (_req, res) => {
  res.json({ service: 'agent-door', version: '0.1.0' });
});

app.post('/register', requireAdminKey, async (req: Request, res: Response) => {
  const { slug, siteName, siteUrl, apiUrl, openApiUrl, rateLimit } = req.body;

  if (!slug || !siteName || !siteUrl) {
    res.status(400).json({ error: 'slug, siteName, and siteUrl are required' });
    return;
  }
  if (!apiUrl && !openApiUrl) {
    res.status(400).json({ error: 'need apiUrl or openApiUrl' });
    return;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(slug)) {
    res.status(400).json({ error: 'slug: 2-40 chars, lowercase alphanumeric and hyphens, no leading/trailing hyphen' });
    return;
  }
  if (RESERVED_SLUGS.has(slug)) {
    res.status(400).json({ error: `'${slug}' is reserved` });
    return;
  }
  if (doors.has(slug)) {
    res.status(409).json({ error: `'${slug}' already registered` });
    return;
  }

  const resolvedApiUrl = (apiUrl ?? siteUrl).replace(/\/$/, '');
  const specUrl = openApiUrl ?? `${resolvedApiUrl}/openapi.json`;

  // block internal network requests
  try {
    await validateExternalUrl(specUrl);
    await validateExternalUrl(resolvedApiUrl);
  } catch (err: any) {
    res.status(400).json({ error: `URL rejected: ${err.message}` });
    return;
  }

  let door: AgentDoor;
  try {
    const specRes = await fetch(specUrl);
    if (!specRes.ok) throw new Error(`${specRes.status} from ${specUrl}`);
    const spec = await specRes.json();
    door = AgentDoor.fromOpenAPI(spec as any, resolvedApiUrl, {
      site: { name: siteName, url: siteUrl },
      rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
      audit: false,
    });
  } catch (err: any) {
    res.status(400).json({ error: `failed to load spec: ${err.message}` });
    return;
  }

  const reg: SiteRegistration = {
    slug,
    siteName,
    siteUrl,
    apiUrl: resolvedApiUrl,
    openApiUrl: openApiUrl ?? undefined,
    rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
    createdAt: new Date(),
  };
  registry.register(reg);
  doors.set(slug, door);

  res.status(201).json({
    slug,
    gatewayUrl: `${baseUrl()}/${slug}`,
    agentsTxt: `${baseUrl()}/${slug}/.well-known/agents.txt`,
    agentsJson: `${baseUrl()}/${slug}/.well-known/agents.json`,
  });
});

app.get('/sites', requireAdminKey, (_req, res) => {
  res.json(registry.list().map(s => ({
    slug: s.slug,
    siteName: s.siteName,
    siteUrl: s.siteUrl,
    gatewayUrl: `${baseUrl()}/${s.slug}`,
    createdAt: s.createdAt,
  })));
});

app.delete('/sites/:slug', requireAdminKey, (req, res) => {
  const { slug } = req.params;
  const door = doors.get(slug);
  if (!door) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  door.destroy();
  doors.delete(slug);
  registry.delete(slug);
  res.json({ deleted: slug });
});

// proxy /:slug/* through to the matching AgentDoor middleware
app.use('/:slug', (req, res, next) => {
  const { slug } = req.params;
  const door = doors.get(slug);
  if (!door) return next(); // fall through to 404

  const saved = req.url;
  const prefix = `/${slug}`;
  req.url = saved.startsWith(prefix) ? (saved.slice(prefix.length) || '/') : saved;

  door.middleware()(req, res, () => {
    req.url = saved;
    next();
  });
});

const PORT = process.env.PORT ?? 3000;

// only listen when run directly, not when imported by tests
if (require.main === module) {
  app.listen(PORT, () => console.log(`agent-door listening on :${PORT}`));
}

export { app };
