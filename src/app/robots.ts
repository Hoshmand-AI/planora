import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/site-url'

// Only the public pages are for search engines; the app, its API and sign-in are not.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl()
  return {
    rules: [{ userAgent: '*', allow: ['/', '/privacy', '/terms'], disallow: ['/dashboard', '/api/', '/auth'] }],
    sitemap: `${base}/sitemap.xml`,
  }
}
