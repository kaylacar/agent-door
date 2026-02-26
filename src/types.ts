export interface SiteRegistration {
  slug: string;
  siteName: string;
  siteUrl: string;
  apiUrl: string;
  openApiUrl?: string;
  rateLimit: number;
  createdAt: Date;
}
