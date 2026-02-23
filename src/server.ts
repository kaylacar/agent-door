import express, { Request, Response } from 'express';
import { AgentDoor } from '@agents-protocol/sdk';
import { Registry } from './registry';
import { SiteRegistration } from './types';

const app = express();
app.use(express.json());

const registry = new Registry();
const doors = new Map<string, AgentDoor>();

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Agent Door Gateway', version: '0.1.0' });
});

// ─── Registration ─────────────────────────────────────────────────────────────

app.post('/register', async (req: Request, res: Response) => {
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

  const resolvedApiUrl = (typeof apiUrl === 'string' ? apiUrl : siteUrl).replace(/\/$/, '');
  const specUrl = typeof openApiUrl === 'string' ? openApiUrl : `${resolvedApiUrl}/openapi.json`;

  let door: AgentDoor;
  try {
    const specRes = await fetch(specUrl);
    if (!specRes.ok) throw new Error(`HTTP ${specRes.status} fetching spec`);
    const spec = await specRes.json();
    door = AgentDoor.fromOpenAPI(spec, resolvedApiUrl, {
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

  res.json({
    ok: true,
    data: {
      slug,
      gateway_url: `https://agentdoor.io/${slug}`,
      agents_txt: `https://agentdoor.io/${slug}/.well-known/agents.txt`,
      agents_json: `https://agentdoor.io/${slug}/.well-known/agents.json`,
    },
  });
});

// ─── List registered sites ────────────────────────────────────────────────────

app.get('/sites', (_req, res) => {
  const sites = registry.list().map(s => ({
    slug: s.slug,
    siteName: s.siteName,
    siteUrl: s.siteUrl,
    gateway_url: `https://agentdoor.io/${s.slug}`,
    createdAt: s.createdAt,
  }));
  res.json({ ok: true, data: sites });
});

// ─── Delete a registration ────────────────────────────────────────────────────

app.delete('/sites/:slug', (req, res) => {
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
  req.url = original.replace(new RegExp(`^/${slug}`), '') || '/';

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
