import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual } from 'crypto';
import { join } from 'path';
import { AgentDoor } from '@agents-protocol/sdk';
import { Registry } from './registry';
import { SiteRegistration, CreateAppOptions } from './types';
import { config } from './config';

// ─── URL validation (SSRF prevention) ──────────────────────────────────────

const PRIVATE_IP_RANGES = [
  /^127\./,                   // loopback
  /^10\./,                    // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,              // 192.168.0.0/16
  /^169\.254\./,              // link-local
  /^0\./,                     // 0.0.0.0/8
];

export function validateUrl(value: string, fieldName: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldName} is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${fieldName} must use http or https`);
  }
  const hostname = url.hostname;
  if (hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0') {
    throw new Error(`${fieldName} must not point to a local address`);
  }
  if (PRIVATE_IP_RANGES.some(re => re.test(hostname))) {
    throw new Error(`${fieldName} must not point to a private network`);
  }
  return url;
}

// ─── Fetch helper with timeout + size limit ─────────────────────────────────

const MAX_SPEC_SIZE = 10_000_000; // 10 MB
const FETCH_TIMEOUT_MS = 30_000;  // 30 seconds

async function fetchSpec(specUrl: string): Promise<unknown> {
  const res = await fetch(specUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching spec`);
  const text = await res.text();
  if (text.length > MAX_SPEC_SIZE) {
    throw new Error(`OpenAPI spec exceeds ${MAX_SPEC_SIZE} byte limit`);
  }
  return JSON.parse(text);
}

// ─── App factory ────────────────────────────────────────────────────────────

export function createApp(options: CreateAppOptions = {}) {
  const apiKey = options.apiKey ?? config.apiKey;
  const gatewayUrl = options.gatewayUrl ?? config.gatewayUrl;
  const registry = options.registry ?? new Registry(join(config.dataDir, 'registry.json'));
  const doors = new Map<string, AgentDoor>();

  const app = express();

  // ─── Security & parsing ──────────────────────────────────────────────────────

  app.use(helmet({ contentSecurityPolicy: false }));

  const corsOrigins = options.corsOrigins ?? (config.corsOrigins ? config.corsOrigins.split(',') : undefined);
  app.use(cors(corsOrigins ? { origin: corsOrigins } : undefined));

  app.use(express.json({ limit: '100kb' }));

  // ─── Rate limiting ───────────────────────────────────────────────────────────

  app.use(rateLimit({
    windowMs: options.rateLimitWindowMs ?? config.rateLimit.windowMs,
    max: options.rateLimitMax ?? config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests, please try again later' },
  }));

  // ─── Request logging ─────────────────────────────────────────────────────────

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: Date.now() - start,
      }));
    });
    next();
  });

  // ─── Auth middleware ─────────────────────────────────────────────────────────

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (!apiKey) { next(); return; }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Authorization required' });
      return;
    }
    const token = header.slice(7);
    const a = Buffer.from(token);
    const b = Buffer.from(apiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(403).json({ ok: false, error: 'Invalid API key' });
      return;
    }
    next();
  }

  // ─── Health check ────────────────────────────────────────────────────────────

  app.get('/', (_req, res) => {
    res.json({ ok: true, service: 'Agent Door Gateway', version: '0.1.0' });
  });

  // ─── Registration (protected) ────────────────────────────────────────────────

  app.post('/register', requireAuth, async (req: Request, res: Response) => {
    const { slug, siteName, siteUrl, apiUrl, openApiUrl, rateLimit: rl, audit } = req.body as Record<string, unknown>;

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

    // Validate all user-provided URLs (SSRF prevention)
    try {
      validateUrl(siteUrl, 'siteUrl');
      if (typeof apiUrl === 'string') validateUrl(apiUrl, 'apiUrl');
      if (typeof openApiUrl === 'string') validateUrl(openApiUrl, 'openApiUrl');
    } catch (err) {
      res.status(400).json({ ok: false, error: (err as Error).message });
      return;
    }

    if (doors.has(slug)) {
      res.status(409).json({ ok: false, error: `Slug '${slug}' is already registered` });
      return;
    }

    const resolvedApiUrl = (typeof apiUrl === 'string' ? apiUrl : siteUrl).replace(/\/$/, '');
    const specUrl = typeof openApiUrl === 'string' ? openApiUrl : `${resolvedApiUrl}/openapi.json`;

    // Reserve slug before the async fetch to prevent race conditions
    const sentinel = {} as AgentDoor;
    doors.set(slug, sentinel);

    let door: AgentDoor;
    try {
      const spec = await fetchSpec(specUrl);
      door = AgentDoor.fromOpenAPI(spec as Parameters<typeof AgentDoor.fromOpenAPI>[0], resolvedApiUrl, {
        site: { name: siteName, url: siteUrl },
        rateLimit: typeof rl === 'number' ? rl : 60,
        audit: audit === true,
      });
    } catch (err) {
      doors.delete(slug);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to load OpenAPI spec from ${specUrl}: ${message}`);
      res.status(400).json({ ok: false, error: 'Could not load OpenAPI spec' });
      return;
    }

    const reg: SiteRegistration = {
      slug,
      siteName,
      siteUrl,
      apiUrl: resolvedApiUrl,
      openApiUrl: typeof openApiUrl === 'string' ? openApiUrl : undefined,
      rateLimit: typeof rl === 'number' ? rl : 60,
      audit: audit === true,
      createdAt: new Date(),
    };

    registry.register(reg);
    doors.set(slug, door);

    res.json({
      ok: true,
      data: {
        slug,
        gateway_url: `${gatewayUrl}/${slug}`,
        agents_txt: `${gatewayUrl}/${slug}/.well-known/agents.txt`,
        agents_json: `${gatewayUrl}/${slug}/.well-known/agents.json`,
      },
    });
  });

  // ─── List registered sites (protected) ──────────────────────────────────────

  app.get('/sites', requireAuth, (_req, res) => {
    const sites = registry.list().map(s => ({
      slug: s.slug,
      siteName: s.siteName,
      siteUrl: s.siteUrl,
      gateway_url: `${gatewayUrl}/${s.slug}`,
      createdAt: s.createdAt,
    }));
    res.json({ ok: true, data: sites });
  });

  // ─── Delete a registration (protected) ──────────────────────────────────────

  app.delete('/sites/:slug', requireAuth, (req, res) => {
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

  // ─── Agent Door routing ──────────────────────────────────────────────────────

  app.use('/:slug', (req, res, next) => {
    const { slug } = req.params;
    const door = doors.get(slug);
    if (!door) {
      res.status(404).json({ ok: false, error: `No agent door registered for '${slug}'` });
      return;
    }

    // Express may or may not strip the /:slug prefix from req.url.
    // Ensure the prefix is removed exactly once before passing to door middleware.
    const original = req.url;
    req.url = original.startsWith(`/${slug}`)
      ? (original.slice(slug.length + 1) || '/')
      : original;

    door.middleware()(req, res, () => {
      req.url = original;
      next();
    });
  });

  // ─── Global error handler ───────────────────────────────────────────────────

  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') {
      res.status(413).json({ ok: false, error: 'Request body too large' });
      return;
    }
    console.error('Unhandled error:', err.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  });

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async function boot(): Promise<void> {
    for (const reg of registry.list()) {
      if (doors.has(reg.slug)) continue;
      const specUrl = reg.openApiUrl ?? `${reg.apiUrl}/openapi.json`;
      try {
        const spec = await fetchSpec(specUrl);
        const door = AgentDoor.fromOpenAPI(spec as Parameters<typeof AgentDoor.fromOpenAPI>[0], reg.apiUrl, {
          site: { name: reg.siteName, url: reg.siteUrl },
          rateLimit: reg.rateLimit,
          audit: reg.audit,
        });
        doors.set(reg.slug, door);
        console.log(`Restored door: ${reg.slug}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Failed to restore door for ${reg.slug}: ${msg}`);
      }
    }
  }

  function shutdown(): void {
    for (const [, door] of doors) {
      try { door.destroy(); } catch { /* ignore */ }
    }
    doors.clear();
  }

  return { app, registry, doors, boot, shutdown };
}

// ─── Start server ────────────────────────────────────────────────────────────

if (require.main === module) {
  const { app, boot, shutdown } = createApp();
  boot()
    .then(() => {
      const server = app.listen(config.port, () => {
        console.log(`Agent Door gateway running on port ${config.port}`);
      });

      const gracefulShutdown = (signal: string) => {
        console.log(`\n${signal} received, shutting down...`);
        shutdown();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 10_000).unref();
      };

      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    })
    .catch((err) => {
      console.error('Failed to start:', err);
      process.exit(1);
    });
}
