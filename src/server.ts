import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import http from 'http';
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

// --- Admin rate limiter (per-IP, 20 req/min) ---
const ADMIN_RATE_LIMIT = 20;
const ADMIN_RATE_WINDOW_MS = 60_000;
const adminRateWindows = new Map<string, number[]>();

function checkAdminRate(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - ADMIN_RATE_WINDOW_MS;
  let timestamps = adminRateWindows.get(ip);
  if (!timestamps) {
    timestamps = [];
    adminRateWindows.set(ip, timestamps);
  }
  // remove expired entries
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }
  if (timestamps.length >= ADMIN_RATE_LIMIT) {
    return false;
  }
  timestamps.push(now);
  return true;
}

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  if (!checkAdminRate(ip)) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }
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

// --- Request logging middleware ---
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
});

app.get('/', (_req, res) => {
  res.json({ service: 'agent-door', version: '0.1.0' });
});

// --- Build a door from a registration (used by both /register and startup restore) ---
async function buildDoor(reg: SiteRegistration): Promise<AgentDoor> {
  const specUrl = reg.openApiUrl ?? `${reg.apiUrl}/openapi.json`;
  const specRes = await fetch(specUrl);
  if (!specRes.ok) throw new Error(`${specRes.status} from ${specUrl}`);
  const spec = await specRes.json();
  return AgentDoor.fromOpenAPI(spec as any, reg.apiUrl, {
    site: { name: reg.siteName, url: reg.siteUrl },
    rateLimit: reg.rateLimit,
    audit: false,
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
  });
}

// --- Restore doors from persisted registry on startup ---
async function restoreDoors(): Promise<void> {
  const sites = registry.list();
  if (sites.length === 0) return;
  console.log(`Restoring ${sites.length} site(s) from registry...`);
  for (const reg of sites) {
    try {
      const door = await buildDoor(reg);
      doors.set(reg.slug, door);
      console.log(`  restored: ${reg.slug}`);
    } catch (err: any) {
      console.error(`  failed to restore ${reg.slug}: ${err.message}`);
    }
  }
}

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

  const reg: SiteRegistration = {
    slug,
    siteName,
    siteUrl,
    apiUrl: resolvedApiUrl,
    openApiUrl: openApiUrl ?? undefined,
    rateLimit: typeof rateLimit === 'number' ? rateLimit : 60,
    createdAt: new Date(),
  };

  let door: AgentDoor;
  try {
    door = await buildDoor(reg);
  } catch (err: any) {
    res.status(400).json({ error: `failed to load spec: ${err.message}` });
    return;
  }

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
  restoreDoors().then(() => {
    const server = app.listen(PORT, () => console.log(`agent-door listening on :${PORT}`));
    setupGracefulShutdown(server);
  });
}

// --- Graceful shutdown ---
function setupGracefulShutdown(server: http.Server): void {
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
      for (const door of doors.values()) {
        door.destroy();
      }
      doors.clear();
      console.log('Shutdown complete');
      process.exit(0);
    });
    // force exit after 10s if connections aren't drained
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export { app, restoreDoors };
