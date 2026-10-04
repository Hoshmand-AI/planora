import { api, json } from '@/lib/server/api'
import { audit, listAudit, verifyAuditChain } from '@/lib/server/audit'
import { csvCell } from '@/lib/export/csv'

/**
 * Organization audit log.
 *   ?targetType=plan&targetId=…   filter (also action=prefix, actorId=…, before=seq, limit=…)
 *   ?verify=1                     recompute the hash chain and report whether it is intact
 *   ?format=csv                   download (up to 50,000 records)
 */
export const GET = api({ permission: 'audit.read' }, async (req, { auth }) => {
  const sp = new URL(req.url).searchParams
  if (sp.get('verify')) {
    const result = await verifyAuditChain(auth.orgId)
    await audit({ action: 'audit.verified', targetType: 'organization', targetId: auth.orgId, detail: { ok: result.ok, count: result.count, brokenAt: result.brokenAt?.seq ?? null } })
    return json(result)
  }
  const filters = {
    targetType: sp.get('targetType') || undefined, targetId: sp.get('targetId') || undefined, action: sp.get('action') || undefined,
    actorId: sp.get('actorId') || undefined, beforeSeq: Number(sp.get('before')) || undefined,
  }
  if (sp.get('format') === 'csv') {
    const events = await listAudit(auth.orgId, { ...filters, limit: 50_000 })
    await audit({ action: 'audit.exported', targetType: 'organization', targetId: auth.orgId, detail: { records: events.length } })
    const head = ['seq', 'at', 'actor_email', 'action', 'target_type', 'target_id', 'detail', 'ip', 'request_id', 'prev_hash', 'hash']
    const rows = events.reverse().map(e => [e.seq, e.at, e.actorEmail, e.action, e.targetType, e.targetId, JSON.stringify(e.detail), e.ip, e.requestId, e.prevHash, e.hash].map(v => csvCell(v == null ? '' : String(v))).join(','))
    return new Response([head.join(','), ...rows].join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="planora-audit-log-${new Date().toISOString().slice(0, 10)}.csv"` } })
  }
  const events = await listAudit(auth.orgId, { ...filters, limit: Number(sp.get('limit')) || 200 })
  return json({ events, nextBefore: events.length ? events[events.length - 1].seq : null })
})
