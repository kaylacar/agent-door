export interface SiteRegistration {
  slug: string;
  siteName: string;
  siteUrl: string;
  apiUrl: string;
  openApiUrl?: string;
  rateLimit: number;
  createdAt: Date;
}

export interface SiteRegistrationWithSpec extends SiteRegistration {
  specJson: string;
}
