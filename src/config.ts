export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiKey: process.env.API_KEY ?? '',
  gatewayUrl: (process.env.GATEWAY_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  dataDir: process.env.DATA_DIR ?? './data',
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '30', 10),
  },
};
