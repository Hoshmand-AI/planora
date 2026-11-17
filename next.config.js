/** @type {import('next').NextConfig} */

// Defense-in-depth response headers (OWASP ASVS V14). The CSP allows only same-origin resources;
// Next.js needs inline scripts/styles for hydration, so 'unsafe-inline' is kept for those only.
const isDev = process.env.NODE_ENV !== 'production'
// Site captures (a photo and a voice note taken on site, stamped with the phone's position) need the camera, the
// microphone and the location, for RunF9's own pages only and only when a member starts a capture: the browser
// asks them each time it is new, and shows its own in-use indicator. A deployment that must not use them at all
// sets RUNF9_SITE_CAPTURE=off at build time: the three stay blocked for every origin, as before, and the feature is hidden.
const siteCapture = process.env.RUNF9_SITE_CAPTURE !== 'off'
const device = siteCapture ? '(self)' : '()'
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // A voice note is played from RunF9 itself, or from the recording still held in the page before it is sent.
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: `camera=${device}, microphone=${device}, geolocation=${device}, payment=(), usb=(), interest-cohort=()` },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

const nextConfig = {
  poweredByHeader: false,
  // When this build was made, for the public product card's release stamp (src/lib/product-card.ts).
  env: { RUNF9_BUILT_AT: process.env.RUNF9_BUILT_AT || new Date().toISOString(), RUNF9_SITE_CAPTURE: siteCapture ? 'on' : 'off' },
  // On-prem container image (Dockerfile): a self-contained server in .next/standalone. Only when
  // RUNF9_STANDALONE=1 is set at build time, so Vercel builds are unchanged.
  ...(process.env.RUNF9_STANDALONE === '1' ? { output: 'standalone' } : {}),
  // pdf-parse (pdf.js) must load from node_modules at runtime: bundled, pdf.js evaluates browser-only
  // globals (DOMMatrix) at module load and every PDF read fails (schedule PDFs and project documents).
  serverExternalPackages: ['pdf-parse'],
  experimental: {},
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Brand images (logos used in emails, social previews) must load inside mail apps and other
      // sites, so they alone may be embedded cross-origin. Later rules win for the same header.
      { source: '/brand/:path*', headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }] },
      // Deploy templates: the Azure portal reads the template from the browser ("Deploy to Azure").
      { source: '/deploy/:path*', headers: [{ key: 'Access-Control-Allow-Origin', value: 'https://portal.azure.com' }, { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }, { key: 'Cache-Control', value: 'public, max-age=300' }] },
      // A site capture's photo or voice note is a file a member uploaded: it is served with no permissions at all
      // (nothing it could contain may run or load anything), on top of the fixed type and nosniff the route sets.
      { source: '/api/schedules/:id/captures/:captureId/media/:mediaId', headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" }] },
    ]
  },
}

module.exports = nextConfig
