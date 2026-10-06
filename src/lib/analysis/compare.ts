// Update-to-update comparison of two uploads of the same project (e.g. Update 5 vs Update 6, or the
// baseline vs the current update). Activities are matched by activity ID (P6 task code / MSP ID),
// relationships by predecessor code + successor code + type. Pure, so it is unit tested.
//
// This is the evidence a monthly update review and a windows / time-impact analysis start from:
// what moved, what was added or deleted, which logic, durations, constraints and calendars changed,
// which actual dates were rewritten after the fact, and where float eroded.

import type { Activity, Relationship, Schedule } from '@/lib/db'

export interface CompareSide {
  schedule: Pick<Schedule, 'id' | 'name' | 'version' | 'dataDate'> & { forecastFinish: string | null }
  activities: Activity[]
  relationships: Relationship[]
  /** Activity ids on the longest path */
  longestPath?: string[]
  finishMilestone?: { code: string; forecastFinish: string | null } | null
}

export interface ActivityChange {
  code: string
  name: string
  field: 'duration' | 'remaining' | 'start' | 'finish' | 'float' | 'constraint' | 'calendar' | 'actual_start' | 'actual_finish' | 'name' | 'baseline_finish'
  before: string | number | null
  after: string | number | null
  /** For dates: calendar days after - before; for numbers: after - before */
  delta: number | null
}

export interface ScheduleComparison {
  before: { id: string; name: string; version: string; dataDate: string | null; forecastFinish: string | null }
  after: { id: string; name: string; version: string; dataDate: string | null; forecastFinish: string | null }
  /** Calendar days the project forecast finish moved (+ = later) */
  finishMovement: number | null
  milestoneMovement: { code: string; before: string | null; after: string | null; delta: number | null } | null
  matched: number
  added: { code: string; name: string }[]
  deleted: { code: string; name: string }[]
  logicAdded: { pred: string; succ: string; type: string; lag: number }[]
  logicDeleted: { pred: string; succ: string; type: string; lag: number }[]
  lagChanged: { pred: string; succ: string; type: string; before: number; after: number }[]
  changes: ActivityChange[]
  /** Actual dates that changed after they were first reported (should not happen) */
  actualsRewritten: ActivityChange[]
  /** Open activities whose total float dropped, largest drop first */
  floatErosion: { code: string; name: string; before: number; after: number; delta: number }[]
  criticalPath: { entered: string[]; left: string[] }
  progress: { started: string[]; finished: string[] }
  summary: string[]
}

const DAY = 86_400_000
const calDays = (a: string | null | undefined, b: string | null | undefined) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / DAY) : null)
const work = (a: Activity) => a.activityType !== 'summary'
const relKey = (p: string, s: string, t: string) => `${p}→${s}|${t}`

export function compareSchedules(before: CompareSide, after: CompareSide): ScheduleComparison {
  const bActs = before.activities.filter(work)
  const aActs = after.activities.filter(work)
  const bByCode = new Map(bActs.map(a => [a.activityId, a]))
  const aByCode = new Map(aActs.map(a => [a.activityId, a]))
  const bCodeOf = new Map(before.activities.map(a => [a.id, a.activityId]))
  const aCodeOf = new Map(after.activities.map(a => [a.id, a.activityId]))

  const added = aActs.filter(a => !bByCode.has(a.activityId)).map(a => ({ code: a.activityId, name: a.name }))
  const deleted = bActs.filter(a => !aByCode.has(a.activityId)).map(a => ({ code: a.activityId, name: a.name }))

  const changes: ActivityChange[] = []
  const actualsRewritten: ActivityChange[] = []
  const floatErosion: ScheduleComparison['floatErosion'] = []
  const started: string[] = [], finished: string[] = []
  let matched = 0
  const push = (c: ActivityChange) => changes.push(c)
  for (const a of aActs) {
    const b = bByCode.get(a.activityId)
    if (!b) continue
    matched++
    const base = { code: a.activityId, name: a.name }
    if (Math.round(b.duration) !== Math.round(a.duration)) push({ ...base, field: 'duration', before: b.duration, after: a.duration, delta: Math.round(a.duration - b.duration) })
    if (a.status !== 'complete' && b.status !== 'complete' && Math.round(b.remainingDuration) !== Math.round(a.remainingDuration) && a.status === 'in_progress' && b.status === 'in_progress') {
      push({ ...base, field: 'remaining', before: b.remainingDuration, after: a.remainingDuration, delta: Math.round(a.remainingDuration - b.remainingDuration) })
    }
    const bf = b.actualFinish || b.earlyFinish, af = a.actualFinish || a.earlyFinish
    const df = calDays(bf, af)
    if (df) push({ ...base, field: 'finish', before: bf, after: af, delta: df })
    if (b.name !== a.name) push({ ...base, field: 'name', before: b.name, after: a.name, delta: null })
    const bk = b.constraintType ? `${b.constraintType} ${b.constraintDate ?? ''}`.trim() : null
    const ak = a.constraintType ? `${a.constraintType} ${a.constraintDate ?? ''}`.trim() : null
    if (bk !== ak) push({ ...base, field: 'constraint', before: bk, after: ak, delta: null })
    if ((b.calendarId || null) !== (a.calendarId || null)) push({ ...base, field: 'calendar', before: b.calendarId ?? null, after: a.calendarId ?? null, delta: null })
    if (b.baselineFinish && a.baselineFinish && b.baselineFinish !== a.baselineFinish) push({ ...base, field: 'baseline_finish', before: b.baselineFinish, after: a.baselineFinish, delta: calDays(b.baselineFinish, a.baselineFinish) })
    // Actuals already reported should not change in a later update.
    if (b.actualStart && b.actualStart !== a.actualStart) actualsRewritten.push({ ...base, field: 'actual_start', before: b.actualStart, after: a.actualStart, delta: calDays(b.actualStart, a.actualStart) })
    if (b.actualFinish && b.actualFinish !== a.actualFinish) actualsRewritten.push({ ...base, field: 'actual_finish', before: b.actualFinish, after: a.actualFinish, delta: calDays(b.actualFinish, a.actualFinish) })
    if (!b.actualStart && a.actualStart) started.push(a.activityId)
    if (!b.actualFinish && a.actualFinish) finished.push(a.activityId)
    if (a.status !== 'complete' && b.status !== 'complete' && a.totalFloat < b.totalFloat) {
      floatErosion.push({ ...base, before: b.totalFloat, after: a.totalFloat, delta: a.totalFloat - b.totalFloat })
    }
  }
  floatErosion.sort((x, y) => x.delta - y.delta)

  const relMap = (rels: Relationship[], codeOf: Map<string, string>) => {
    const m = new Map<string, { pred: string; succ: string; type: string; lag: number }>()
    for (const r of rels) {
      const p = codeOf.get(r.predecessorId), s = codeOf.get(r.successorId)
      if (p && s) m.set(relKey(p, s, r.type), { pred: p, succ: s, type: r.type, lag: r.lag })
    }
    return m
  }
  const bRel = relMap(before.relationships, bCodeOf)
  const aRel = relMap(after.relationships, aCodeOf)
  const logicAdded = [...aRel].filter(([k]) => !bRel.has(k)).map(([, v]) => v)
  const logicDeleted = [...bRel].filter(([k]) => !aRel.has(k)).map(([, v]) => v)
  const lagChanged = [...aRel].filter(([k, v]) => bRel.has(k) && bRel.get(k)!.lag !== v.lag).map(([, v]) => ({ pred: v.pred, succ: v.succ, type: v.type, before: bRel.get(relKey(v.pred, v.succ, v.type))!.lag, after: v.lag }))

  const pathCodes = (side: CompareSide, codeOf: Map<string, string>) => new Set((side.longestPath?.length ? side.longestPath : side.activities.filter(x => x.isCritical).map(x => x.id)).map(id => codeOf.get(id)).filter((c): c is string => !!c))
  const bPath = pathCodes(before, bCodeOf), aPath = pathCodes(after, aCodeOf)
  const entered = [...aPath].filter(c => !bPath.has(c))
  const left = [...bPath].filter(c => !aPath.has(c) && aByCode.has(c) && aByCode.get(c)!.status !== 'complete')

  const finishMovement = calDays(before.schedule.forecastFinish, after.schedule.forecastFinish)
  let milestoneMovement: ScheduleComparison['milestoneMovement'] = null
  const fmCode = after.finishMilestone?.code ?? before.finishMilestone?.code
  if (fmCode) {
    const bm = bByCode.get(fmCode), am = aByCode.get(fmCode)
    const bd = before.finishMilestone?.code === fmCode ? before.finishMilestone.forecastFinish : bm?.earlyFinish ?? null
    const ad = after.finishMilestone?.code === fmCode ? after.finishMilestone.forecastFinish : am?.earlyFinish ?? null
    milestoneMovement = { code: fmCode, before: bd, after: ad, delta: calDays(bd, ad) }
  }

  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  const summary: string[] = []
  if (finishMovement != null) summary.push(finishMovement === 0 ? 'The forecast finish did not move.' : `The forecast finish moved ${Math.abs(finishMovement)} calendar days ${finishMovement > 0 ? 'later' : 'earlier'} (${before.schedule.forecastFinish} → ${after.schedule.forecastFinish}).`)
  if (milestoneMovement?.delta) summary.push(`${milestoneMovement.code} moved ${Math.abs(milestoneMovement.delta)} calendar days ${milestoneMovement.delta > 0 ? 'later' : 'earlier'}.`)
  summary.push(`${n(started.length, 'activity', 'activities')} started and ${finished.length} finished this period.`)
  if (added.length || deleted.length) summary.push(`${n(added.length, 'activity', 'activities')} added, ${deleted.length} deleted.`)
  if (logicAdded.length || logicDeleted.length || lagChanged.length) summary.push(`Logic: ${n(logicAdded.length, 'relationship')} added, ${logicDeleted.length} deleted, ${lagChanged.length} lag ${lagChanged.length === 1 ? 'change' : 'changes'}.`)
  const durCh = changes.filter(c => c.field === 'duration')
  if (durCh.length) summary.push(`${n(durCh.length, 'original duration')} changed.`)
  const cstrCh = changes.filter(c => c.field === 'constraint')
  if (cstrCh.length) summary.push(`${n(cstrCh.length, 'constraint')} added, removed or changed.`)
  if (actualsRewritten.length) summary.push(`${n(actualsRewritten.length, 'previously reported actual date')} changed; actuals should not be rewritten in a later update.`)
  if (floatErosion.length) summary.push(`Float dropped on ${n(floatErosion.length, 'open activity', 'open activities')}; the largest drop is ${floatErosion[0].code} (${floatErosion[0].before} → ${floatErosion[0].after} work days).`)
  if (entered.length || left.length) summary.push(`Driving path: ${entered.length} joined, ${left.length} left.`)

  return {
    before: { id: before.schedule.id, name: before.schedule.name, version: before.schedule.version, dataDate: before.schedule.dataDate, forecastFinish: before.schedule.forecastFinish },
    after: { id: after.schedule.id, name: after.schedule.name, version: after.schedule.version, dataDate: after.schedule.dataDate, forecastFinish: after.schedule.forecastFinish },
    finishMovement, milestoneMovement, matched, added, deleted, logicAdded, logicDeleted, lagChanged, changes, actualsRewritten,
    floatErosion, criticalPath: { entered, left }, progress: { started, finished }, summary,
  }
}
