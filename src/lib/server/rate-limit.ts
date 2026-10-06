// Fixed-window rate limits and quotas backed by Postgres, so limits hold across serverless instances.

import { initSchema, query } from '@/lib/db'

export interface LimitResult { ok: boolean; count: number; limit: number; retryAfterSec: number }

export async function hit(key: string, limit: number, windowSec: number): Promise<LimitResult> {
  await initSchema()
  const res = await query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, NOW(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= NOW() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= NOW() - make_interval(secs => $2) THEN NOW() ELSE rate_limits.window_start END
     RETURNING count, EXTRACT(EPOCH FROM (window_start + make_interval(secs => $2) - NOW())) AS remaining`,
    [key, windowSec])
  const count = Number(res.rows[0].count)
  return { ok: count <= limit, count, limit, retryAfterSec: Math.max(1, Math.ceil(Number(res.rows[0].remaining))) }
}

/** Current count without incrementing (for showing remaining quota). */
export async function peek(key: string, windowSec: number): Promise<number> {
  await initSchema()
  const res = await query(`SELECT count FROM rate_limits WHERE key=$1 AND window_start > NOW() - make_interval(secs => $2)`, [key, windowSec])
  return res.rows[0] ? Number(res.rows[0].count) : 0
}

export async function reset(key: string) {
  await initSchema()
  await query('DELETE FROM rate_limits WHERE key=$1', [key])
}

/** Daily AI quota key for an organization (UTC day). */
export const aiQuotaKey = (orgId: string) => `ai:org:${orgId}:${new Date().toISOString().slice(0, 10)}`

export const LIMITS = {
  /**
   * FAILED sign-ins per source IP. Generous because whole offices and job-site trailers share one
   * egress IP; the strict control is per account (signinPerEmail + lockoutAfter).
   */
  signinFailuresPerIp: { limit: 300, windowSec: 15 * 60 },
  signinPerEmail: { limit: 10, windowSec: 15 * 60 },
  signupPerIp: { limit: 20, windowSec: 60 * 60 },
  mfaPerUser: { limit: 10, windowSec: 15 * 60 },
  apiPerUser: { limit: 600, windowSec: 60 },
  aiPerUser: { limit: 20, windowSec: 60 },
  uploadsPerOrg: { limit: 60, windowSec: 60 * 60 },
  exportsPerUser: { limit: 60, windowSec: 60 * 60 },
  /** Consecutive failed passwords before the account is locked, and for how long. */
  lockoutAfter: 8,
  lockoutMinutes: 15,
}
