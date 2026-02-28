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

export interface IRegistry {
  register(reg: SiteRegistration): void | Promise<void>;
  get(slug: string): SiteRegistration | null | Promise<SiteRegistration | null>;
  list(): SiteRegistration[] | Promise<SiteRegistration[]>;
  delete(slug: string): boolean | Promise<boolean>;
  close?(): void | Promise<void>;
}

export interface CreateAppOptions {
  registry?: IRegistry;
  apiKey?: string;
  gatewayUrl?: string;
  corsOrigins?: string[];
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}
