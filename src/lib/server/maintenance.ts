// Retention and housekeeping. Runs at most once an hour across all instances (claimed through
// maintenance_runs), triggered opportunistically by normal traffic so it needs no scheduler or
// extra secret. Each organization's retention settings decide what is deleted; deletions are
// recorded in that organization's audit log.

import { initSchema, query } from '@/lib/db'
import { normalizeSettings } from './settings'
import { log, errorFields } from './log'

let lastLocalRun = 0

export interface PurgeSummary { orgId: string; chatMessages: number; plans: number; schedules: number }

export async function runRetention(): Promise<{ housekeeping: Record<string, number>; orgs: PurgeSummary[] }> {
  await initSchema()
  const housekeeping: Record<string, number> = {}
  housekeeping.rateLimits = (await query(`DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '2 days'`)).rowCount ?? 0
  housekeeping.sessions = (await query(`DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days') OR expires_at < NOW() - INTERVAL '30 days'`)).rowCount ?? 0
  housekeeping.invitations = (await query(`DELETE FROM invitations WHERE (accepted_at IS NULL) AND (expires_at < NOW() - INTERVAL '30 days' OR revoked_at < NOW() - INTERVAL '30 days')`)).rowCount ?? 0

  const orgs: PurgeSummary[] = []
  const { audit } = await import('./audit')
  const rows = (await query('SELECT id, settings FROM organizations')).rows
  for (const o of rows) {
    const s = normalizeSettings(o.settings)
    const sum: PurgeSummary = { orgId: o.id, chatMessages: 0, plans: 0, schedules: 0 }
    if (s.chatRetentionDays > 0) {
      sum.chatMessages = (await query(`DELETE FROM chat_messages c USING schedules s WHERE c.schedule_id=s.id AND s.org_id=$1 AND c.created_at < NOW() - make_interval(days => $2)`, [o.id, s.chatRetentionDays])).rowCount ?? 0
    }
    if (s.projectRetentionDays > 0) {
      sum.plans = (await query(`DELETE FROM plans WHERE org_id=$1 AND updated_at < NOW() - make_interval(days => $2)`, [o.id, s.projectRetentionDays])).rowCount ?? 0
      sum.schedules = (await query(`DELETE FROM schedules WHERE org_id=$1 AND uploaded_at < NOW() - make_interval(days => $2) AND (plan_id IS NULL OR plan_id NOT IN (SELECT id FROM plans WHERE org_id=$1))`, [o.id, s.projectRetentionDays])).rowCount ?? 0
    }
    if (sum.chatMessages || sum.plans || sum.schedules) {
      orgs.push(sum)
      await audit({ orgId: o.id, action: 'retention.purge', actor: { id: null, email: 'system' }, detail: { ...sum, chatRetentionDays: s.chatRetentionDays, projectRetentionDays: s.projectRetentionDays } })
    }
  }
  return { housekeeping, orgs }
}

/** Claims the hourly slot and runs retention. Never throws. */
export async function maybeRunMaintenance(): Promise<void> {
  if (Date.now() - lastLocalRun < 10 * 60_000) return
  lastLocalRun = Date.now()
  try {
    await initSchema()
    const claim = await query(`INSERT INTO maintenance_runs (name, last_run_at) VALUES ('retention', NOW())
      ON CONFLICT (name) DO UPDATE SET last_run_at = NOW() WHERE maintenance_runs.last_run_at < NOW() - INTERVAL '1 hour'
      RETURNING last_run_at`)
    if (!claim.rowCount) return
    const result = await runRetention()
    log('info', 'retention run', result as unknown as Record<string, unknown>)
  } catch (err) {
    log('error', 'retention run failed', errorFields(err))
  }
}
