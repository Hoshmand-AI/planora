// Upload size limits that hold where the app actually runs.
//
// Vercel Functions reject a request body over 4.5 MB before the app sees it (413
// FUNCTION_PAYLOAD_TOO_LARGE, a plain-text platform page). So on Vercel the effective file limit is
// a little under that (multipart framing and the other form fields share the body); self-hosted and
// on-prem servers keep the app's own, larger limits.

/** Largest request body Vercel Functions accept. */
export const VERCEL_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024
/** Room left for multipart boundaries and the other form fields. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/** The file size an upload can really have here: `appLimit`, capped below the platform's body limit on Vercel. */
export function effectiveUploadLimit(appLimit: number, env: Record<string, string | undefined> = process.env): number {
  return env.VERCEL ? Math.min(appLimit, VERCEL_BODY_LIMIT_BYTES - MULTIPART_OVERHEAD_BYTES) : appLimit
}

/** "4.4 MB", "25 MB" */
export function formatMb(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

/** What to tell someone whose upload was refused for size (also used when the platform answers 413 with no JSON). */
export function tooLargeMessage(kind: 'schedule' | 'document', limitBytes?: number): string {
  const limit = limitBytes ? ` (the limit is ${formatMb(limitBytes)})` : ''
  return kind === 'schedule'
    ? `This file is too large to upload${limit}. Export only this project from P6 or MS Project, without other projects, unused codes or baselines you don't need, and try again; for larger files, contact support.`
    : `This file is too large to upload${limit}. Split it (for example by specification section) and upload the parts.`
}
