// Gathers what the Daily Brief needs for one project (org-scoped) and builds it: the living schedule
// (the upload with the edits made in RunF9), the register, signals from correspondence, recent changes,
// the previous update, logic findings and the day's what-if runs.

import { getScheduleSeries } from '@/lib/db'
import { orderSeries } from '@/lib/analysis/compare'
import { buildDailyBrief, missingScope, type BriefChange, type BriefWhatIf, type DailyBrief } from '@/lib/analysis/daily-brief'
import { extractSignals, SIGNAL_DOC_TYPES } from '@/lib/analysis/correspondence'
import { projectWatch, type BriefAlert, type ProjectWatch, type WatchChunk } from '@/lib/analysis/project-watch'
import { contractTarget, loadScheduleData, networkOf } from '@/lib/planning/service'
import { evaluateNetwork, uploadedRecoveryOptions } from '@/lib/planning/uploaded-recovery'
import { remainingOf } from '@/lib/planning/uploaded-edits'
import { suggestLogic } from '@/lib/logic-assist'
import { scopedChunks } from '@/lib/rag/store'
import { currentWorkspaceAccess } from '@/lib/server/workspace-scope'
import { log } from '@/lib/server/log'
import { listRegister, registerKey } from './register'

const us = (d: string | null | undefined) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : '—')
const diff = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 86_400_000)
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'))
/** Edits made in the last this-many days are "recent changes". */
export const RECENT_CHANGE_DAYS = 7

export interface BriefOptions { asOf?: string | null; whatIf?: { activity: string; days: number } | null }

export async function loadDailyBrief(scheduleId: string, orgId: string, o: BriefOptions = {}): Promise<{ brief: DailyBrief; watch: ProjectWatch; alerts: BriefAlert[]; schedule: { id: string; name: string; version: string; editsApplied: number; sourceType: string }; activities: { id: string; code: string; name: string }[] } | null> {
  const data = await loadScheduleData(scheduleId, orgId, { basis: 'scenario' })
  if (!data) return null
  const s = data.schedule
  const today = isDay(o.asOf) ? o.asOf : new Date().toISOString().slice(0, 10)
  const net = networkOf(data)
  const base = data.cpm ? evaluateNetwork(net, []) : null
  const target = contractTarget(data.analysis)
  const byCode = new Map(data.activities.map(a => [a.activityId.toLowerCase(), a]))
  const openTask = (a: (typeof data.activities)[number] | undefined) => !!a && a.activityType === 'task' && a.status !== 'complete' && !a.actualFinish

  const register = await listRegister(orgId, registerKey(s)).catch(err => { log('warn', 'register unavailable', { error: (err as Error).message }); return [] })

  // Signals: unflagged passages of the project's correspondence (never passages that read like instructions).
  let signals: ReturnType<typeof extractSignals> = []
  let docChunks: WatchChunk[] = []
  try {
    const all = (await scopedChunks({ orgId, scheduleId: s.id, access: await currentWorkspaceAccess() }, { includeUnreviewed: true, limit: 3000 })).filter(c => !c.flagged && c.scope === 'project')
    docChunks = all.map(c => ({ documentId: c.documentId, title: c.title, docType: c.docType, citation: c.citation, text: c.text }))
    const chunks = all.filter(c => SIGNAL_DOC_TYPES.includes(c.docType))
    signals = extractSignals(chunks.map(c => ({ documentId: c.documentId, title: c.title, docType: c.docType, citation: c.citation, text: c.text })),
      data.activities.filter(a => a.activityType === 'task' || a.activityType === 'milestone').map(a => ({ id: a.id, code: a.activityId, name: a.name, open: a.status !== 'complete' && !a.actualFinish })))
  } catch (err) { log('warn', 'correspondence signals unavailable', { error: (err as Error).message }) }

  // Recent changes made in RunF9 (the override layer), newest first.
  const since = Date.now() - RECENT_CHANGE_DAYS * 86_400_000
  const changes: BriefChange[] = data.edits.filter(e => e.status === 'applied' && Date.parse(e.at) >= since).reverse().slice(0, 20)
    .map(e => ({ what: e.label, before: e.before, after: e.after, by: e.byName || 'Member', at: e.at, reason: e.reason, source: e.source ?? 'manual' }))

  // The day's what-if runs: all on the real network, nothing saved.
  const whatIfs: BriefWhatIf[] = []
  const slip = (a: (typeof data.activities)[number], days: number, lead: string): BriefWhatIf | null => {
    if (!base?.measured) return null
    const r = evaluateNetwork(net, [{ kind: 'duration', activityId: a.id, remaining: remainingOf(a) + days }])
    if (!r.measured) return null
    const d = diff(base.measured, r.measured)
    return {
      title: `${lead}: ${a.activityId} ${a.name} +${days} work days`, finishBefore: base.measured, finishAfter: r.measured, days: d,
      text: d > 0 ? `If ${a.activityId} ${a.name} takes ${days} work days longer, the finish moves from ${us(base.measured)} to ${us(r.measured)} (${d} calendar day${d === 1 ? '' : 's'} later).`
        : `If ${a.activityId} ${a.name} takes ${days} work days longer, the finish stays ${us(base.measured)}: it has enough float to absorb it.`,
    }
  }
  if (base) {
    const pathIds = data.analysis.drivingPath?.ids?.length ? data.analysis.drivingPath.ids : base.longestPath
    const driver = pathIds.map(id => data.activities.find(a => a.id === id)).find(a => openTask(a) && remainingOf(a!) > 0)
    if (o.whatIf) {
      const a = byCode.get(o.whatIf.activity.trim().toLowerCase())
      const days = Math.max(1, Math.min(365, Math.round(o.whatIf.days)))
      const w = a && openTask(a) ? slip(a, days, 'Your what-if') : null
      whatIfs.push(w ?? { title: 'Your what-if', text: `No open activity "${o.whatIf.activity.slice(0, 40)}" in this schedule; use an activity ID from the Schedule tab.`, finishBefore: null, finishAfter: null, days: null })
    }
    if (driver) { const w = slip(driver, 5, 'Default what-if'); if (w) whatIfs.push(w) }
    // What the open change items and the correspondence would do, where they name an activity and a number of days.
    for (const r of register.filter(x => x.status === 'open' && (x.impactDays ?? 0) > 0 && x.activityCodes?.length).slice(0, 2)) {
      const a = r.activityCodes!.map(c => byCode.get(c.toLowerCase())).find(openTask)
      const w = a ? slip(a, r.impactDays!, `Register: ${r.title.slice(0, 60)}`) : null
      if (w) whatIfs.push(w)
    }
    for (const sg of signals.filter(x => x.activity && x.days && (x.kind === 'delay' || x.kind === 'change')).slice(0, 2)) {
      const a = data.activities.find(x => x.id === sg.activity!.id)
      const w = openTask(a) ? slip(a!, Math.min(365, sg.days!), `Correspondence: ${sg.title.slice(0, 50)}`) : null
      if (w) whatIfs.push(w)
    }
    try {
      const plan = uploadedRecoveryOptions({ ...net, projectType: s.projectType ?? null })
      const best = plan?.options.filter(x => x.daysSaved > 0).sort((x, y) => y.daysSaved - x.daysSaved)[0]
      if (plan && best) whatIfs.push({
        title: `Best recovery option: ${best.title}`, finishBefore: plan.finish, finishAfter: best.newFinish, days: -best.daysSaved,
        text: `${best.title}: the finish moves from ${us(plan.finish)} to ${us(best.newFinish)} (${best.daysSaved} calendar day${best.daysSaved === 1 ? '' : 's'} earlier). Trade-off: ${best.tradeoff}`,
      })
    } catch (err) { log('warn', 'recovery what-if unavailable', { error: (err as Error).message }) }
  }

  // Logic findings (deterministic; the same engine as Quality → Logic suggestions).
  const lg = suggestLogic(data.activities, data.relationships)
  const logic = {
    looseEnds: lg.summary.looseEnds,
    outOfSequence: lg.suggestions.filter(x => x.kind === 'out_of_sequence').map(x => ({ text: `${x.predecessor.code} ${x.predecessor.name} → ${x.successor.code} ${x.successor.name}`, reason: x.reason })),
    proposals: lg.suggestions.filter(x => x.action === 'add_link').map(x => ({ text: `Link ${x.predecessor.code} ${x.predecessor.name} → ${x.successor.code} ${x.successor.name}`, reason: `${x.problem} ${x.reason}` })),
  }

  // Since the previous update of the same project.
  let sinceLastUpdate: DailyBrief['changed']['sinceLastUpdate'] = null
  if (s.projectKey) {
    try {
      const series = orderSeries(await getScheduleSeries(orgId, s.projectKey))
      const idx = series.findIndex(x => x.id === s.id)
      const prev = idx > 0 ? series[idx - 1] : undefined
      const p = prev ? await loadScheduleData(prev.id, orgId) : null
      if (p) {
        const key = (r: { predecessorId: string; successorId: string; type: string; lag: number }, acts: typeof data.activities) => {
          const c = (id: string) => acts.find(a => a.id === id)?.activityId ?? id
          return `${c(r.predecessorId)}>${c(r.successorId)}:${r.type}:${r.lag}`
        }
        const before = new Map(p.activities.map(a => [a.activityId, a]))
        const after = new Map(data.activities.map(a => [a.activityId, a]))
        const relB = new Set(p.relationships.map(r => key(r, p.activities))), relA = new Set(data.relationships.map(r => key(r, data.activities)))
        sinceLastUpdate = {
          version: `${p.schedule.name} (${p.schedule.version})`,
          finishMovedDays: p.analysis.forecastFinish && data.analysis.forecastFinish ? diff(p.analysis.forecastFinish, data.analysis.forecastFinish) : null,
          added: [...after.keys()].filter(c => !before.has(c)).length, deleted: [...before.keys()].filter(c => !after.has(c)).length,
          logicChanges: [...relA].filter(k => !relB.has(k)).length + [...relB].filter(k => !relA.has(k)).length,
          durationChanges: [...after.values()].filter(a => { const b = before.get(a.activityId); return b && Math.round(b.duration) !== Math.round(a.duration) }).length,
        }
      }
    } catch (err) { log('warn', 'previous update unavailable', { error: (err as Error).message }) }
  }

  const brief = buildDailyBrief({
    today, dataDate: s.dataDate, activities: data.activities, relationships: data.relationships,
    forecastFinish: data.analysis.forecastFinish,
    required: target?.date ? { date: target.date, source: target.dateSource, milestone: target.code ? { code: target.code, name: target.name ?? '' } : null } : null,
    milestoneForecast: base?.measured ?? data.analysis.forecastFinish,
    drivingPathIds: data.analysis.drivingPath?.ids?.length ? data.analysis.drivingPath.ids : base?.longestPath ?? [],
    register, signals, changes, submittedFinish: data.editsApplied ? data.submittedForecastFinish : null,
    whatIfs, logic, missingScope: missingScope(data.activities, s.projectType), sinceLastUpdate,
  })
  // The project's documents read against the schedule: contract clauses, drawings and specifications, field reports.
  const watch = projectWatch(docChunks, data.activities.filter(a => a.activityType === 'task' || a.activityType === 'milestone').map(a => ({ id: a.id, code: a.activityId, name: a.name, wbs: a.wbs, started: !!a.actualStart || a.status === 'in_progress', done: a.status === 'complete' || !!a.actualFinish })), {
    daysBehind: brief.headline.daysBehind, staleDays: brief.staleDays, projectType: s.projectType,
    delaysReported: signals.filter(x => x.kind === 'delay' || x.kind === 'change').map(x => ({ title: x.title, activity: x.activity ? `${x.activity.code} ${x.activity.name}` : null })),
    openChangeItems: brief.changeItems.length,
  })

  // What needs someone's attention today, most pressing first.
  const alerts: BriefAlert[] = []
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  if (brief.headline.status === 'behind') alerts.push({ level: 'act', section: 'deadline', text: `The forecast is ${n(brief.headline.daysBehind!, 'day')} behind the required date.` })
  if (brief.overdue.finishCount) alerts.push({ level: 'act', section: 'overdue', text: `${n(brief.overdue.finishCount, 'activity', 'activities')} should have finished by now with no actual finish.` })
  if (brief.overdue.startCount) alerts.push({ level: 'act', section: 'overdue', text: `${n(brief.overdue.startCount, 'activity', 'activities')} should have started by now with no actual start.` })
  for (const c of watch.contract.filter(x => x.active)) alerts.push({ level: 'act', section: 'contract', text: c.text })
  for (const f of watch.field) alerts.push({ level: 'act', section: 'field', text: f.text })
  const overdueItems = register.filter(r => r.status === 'open' && r.dueDate && r.dueDate < today)
  if (overdueItems.length) alerts.push({ level: 'act', section: 'register', text: `${n(overdueItems.length, 'register item')} past due: ${overdueItems.slice(0, 2).map(r => r.title).join('; ')}.` })
  const newDelays = signals.filter(x => x.kind === 'delay')
  if (newDelays.length) alerts.push({ level: 'watch', section: 'signals', text: `${n(newDelays.length, 'delay')} reported in emails, minutes or field reports${newDelays[0].activity ? `, including ${newDelays[0].activity.code} ${newDelays[0].activity.name}` : ''}.` })
  if (brief.today.starting.length || brief.today.finishing.length) alerts.push({ level: 'watch', section: 'today', text: `Today: ${n(brief.today.starting.length, 'start')} and ${n(brief.today.finishing.length, 'finish', 'finishes')} are scheduled${[...brief.today.starting, ...brief.today.finishing].some(r => r.critical) ? ', some on the critical path' : ''}.` })
  if (brief.lookahead.becomingCritical.length) alerts.push({ level: 'watch', section: 'lookahead', text: `${n(brief.lookahead.becomingCritical.length, 'activity is', 'activities are')} within ${10} work days of becoming critical.` })
  if (watch.notInSchedule.length) alerts.push({ level: 'watch', section: 'documents', text: `The project documents name ${n(watch.notInSchedule.length, 'kind')} of work that no activity covers: ${watch.notInSchedule.slice(0, 3).map(x => x.label).join('; ')}.` })
  if (brief.staleDays != null && brief.staleDays > 10) alerts.push({ level: 'watch', section: 'deadline', text: `Progress is ${brief.staleDays} days old. Record progress or upload an update.` })

  return {
    brief, watch, alerts,
    schedule: { id: s.id, name: s.name, version: s.version, editsApplied: data.editsApplied, sourceType: s.sourceType },
    activities: data.activities.filter(a => (a.activityType === 'task' || a.activityType === 'milestone') && a.status !== 'complete' && !a.actualFinish).map(a => ({ id: a.id, code: a.activityId, name: a.name })),
  }
}
