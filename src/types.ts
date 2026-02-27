export interface SiteRegistration {
  slug: string;
  siteName: string;
  siteUrl: string;
  apiUrl: string;
  openApiUrl?: string;
  rateLimit: number;
  audit: boolean;
  createdAt: Date;
}

export interface CreateAppOptions {
  registry?: import('./registry').Registry;
  apiKey?: string;
  gatewayUrl?: string;
  corsOrigins?: string[];
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}
