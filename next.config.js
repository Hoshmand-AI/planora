/** @type {import('next').NextConfig} */

// Defense-in-depth response headers (OWASP ASVS V14). The CSP allows only same-origin resources;
// Next.js needs inline scripts/styles for hydration, so 'unsafe-inline' is kept for those only.
const isDev = process.env.NODE_ENV !== 'production'
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
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
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
]

const nextConfig = {
  poweredByHeader: false,
  // On-prem container image (Dockerfile): a self-contained server in .next/standalone. Only when
  // PLANORA_STANDALONE=1 is set at build time, so Vercel builds are unchanged.
  ...(process.env.PLANORA_STANDALONE === '1' ? { output: 'standalone' } : {}),
  // pdf-parse (pdf.js) must load from node_modules at runtime: bundled, pdf.js evaluates browser-only
  // globals (DOMMatrix) at module load and every PDF read fails (schedule PDFs and project documents).
  serverExternalPackages: ['pdf-parse'],
  experimental: {},
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
