import { publicApi, json } from '@/lib/server/api'
import { query, schemaStatus } from '@/lib/db'
import { resolveLlmConfig } from '@/lib/llm/provider'
import { planoraRelease } from '@/lib/export/provenance'

/**
 * Liveness/readiness for uptime monitoring: database reachable, schema current, AI routing mode.
 * Public and unauthenticated, so it reveals no data, hosts or secrets.
 */
export const GET = publicApi(async () => {
  const started = Date.now()
  let db: { ok: boolean; latencyMs?: number; error?: string } = { ok: false }
  let schema: { latest: number; applied: number; current: boolean } | null = null
  try {
    await query('SELECT 1')
    db = { ok: true, latencyMs: Date.now() - started }
    const s = await schemaStatus()
    const applied = Math.max(0, ...s.applied)
    schema = { latest: s.latest, applied, current: applied >= s.latest }
  } catch {
    db = { ok: false, error: 'database unreachable' }
  }
  const llm = resolveLlmConfig()
  const ok = db.ok && !!schema?.current
  return json({
    status: ok ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    release: planoraRelease(),
    checks: { database: db, schema, ai: { mode: llm.mode, airgapped: llm.airgapped, configured: !llm.error } },
  }, { status: ok ? 200 : 503 })
}, { optionalAuth: false })
