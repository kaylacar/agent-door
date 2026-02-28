function parseIntStrict(value: string, name: string): number {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got '${value}'`);
  }
  return parsed;
}

export const config = {
  port: parseIntStrict(process.env.PORT ?? '3000', 'PORT'),
  apiKey: process.env.API_KEY ?? '',
  gatewayUrl: (process.env.GATEWAY_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR ?? './data',
  databaseUrl: process.env.DATABASE_URL ?? '',
  corsOrigins: process.env.CORS_ORIGINS ?? '',
  rateLimit: {
    windowMs: parseIntStrict(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 'RATE_LIMIT_WINDOW_MS'),
    max: parseIntStrict(process.env.RATE_LIMIT_MAX ?? '30', 'RATE_LIMIT_MAX'),
  },
};

if (process.env.NODE_ENV === 'production' && !config.apiKey) {
  throw new Error('API_KEY environment variable is required in production');
}
