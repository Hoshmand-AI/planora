/**
 * Public origin of this deployment, for robots.txt, the sitemap and link previews: APP_URL when set
 * (the same setting email links use), else Vercel's production domain, else localhost.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const app = (env.APP_URL || '').trim()
  if (/^https?:\/\//i.test(app)) return app.replace(/\/+$/, '')
  const vercel = (env.VERCEL_PROJECT_PRODUCTION_URL || '').trim()
  if (vercel) return `https://${vercel.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`
  return 'http://localhost:3000'
}
