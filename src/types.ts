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
