// The program master schedule: several projects on one page, each read from its contractor's own schedule.
//
// The rule the whole file serves: a contractor date on the master is never typed. Every program has a short list
// of standard milestones (its dictionary). Each project maps a dictionary milestone to one activity of the
// contractor's schedule, by activity ID. The master then reads that activity's date from the project's latest
// upload, so the master and the contractor's schedule cannot disagree. What the owner believes instead goes in a
// separate "owner forecast" beside the contractor date, never over it. Every project row also says how old its
// data is, because a master is only as current as the last update each contractor sent.
//
// Pure (no database, no clock unless passed in), so it is unit tested.

export interface DictMilestone {
  /** Stable key: never shown, never reused for another milestone */
  key: string
  name: string
  /** The phase the milestone belongs to (Design, Construction, ...) */
  phase: string
}

/** Which activity of the contractor's schedule a dictionary milestone reads, and which of its two dates. */
export interface MappedRef { code: string; use: 'start' | 'finish' }

/** The dates of one activity as the contractor's file holds them. */
export interface ActivityDates {
  code: string
  name: string
  type: string
  milestoneKind?: 'start' | 'finish' | null
  earlyStart: string | null
  earlyFinish: string | null
  actualStart: string | null
  actualFinish: string | null
  baselineStart: string | null
  baselineFinish: string | null
  totalFloat: number | null
  isCritical: boolean
}

/** What the owner believes a date will be, kept beside the contractor's date. */
export interface OwnerForecast { date: string; note: string | null; by: string | null; at: string }

export interface UploadRef { id: string; version: string; dataDate: string | null; uploadedAt: string }

export interface ProjectInput {
  id: string
  name: string
  sector: string | null
  location: string | null
  contractor: string | null
  mapping: Record<string, MappedRef>
  ownerForecasts: Record<string, OwnerForecast>
  /** The newest upload of the project; null when the project has no upload the reader may see */
  latest: UploadRef | null
  /** The upload before the newest one */
  previous: UploadRef | null
  /** The project's stored baseline upload */
  baseline: UploadRef | null
  /** The reviewer asked for the newest upload to be revised and resubmitted */
  latestRejected: boolean
  /** Activities by activity ID, for the mapped IDs only */
  latestActs: Record<string, ActivityDates>
  previousActs: Record<string, ActivityDates>
  baselineActs: Record<string, ActivityDates>
}

/** How current a project's contractor data is. */
export type DataStatus = 'current' | 'provisional' | 'stale' | 'expired' | 'none'

/** A contractor update is expected every month: older than this, the project's dates are stale. */
export const STALE_AFTER_DAYS = 45
/** Two updates missed: the dates are no longer a forecast anyone sent. */
export const EXPIRED_AFTER_DAYS = 75

export const DATA_STATUS_LABEL: Record<DataStatus, string> = {
  current: 'Current', provisional: 'Not accepted', stale: 'Stale', expired: 'Expired', none: 'No schedule',
}

export interface MasterCell {
  key: string
  mapped: MappedRef | null
  /** Mapped, but the activity ID is not in the newest upload */
  missing: boolean
  activityName: string | null
  /** The contractor's date, exactly as in the newest upload */
  date: string | null
  /** The date is an actual (the work happened), not a forecast */
  actual: boolean
  baseline: string | null
  previous: string | null
  /** Calendar days later (+) or earlier (−) than the baseline */
  varianceDays: number | null
  /** Calendar days the date moved since the previous upload */
  movedDays: number | null
  totalFloat: number | null
  critical: boolean
  ownerForecast: OwnerForecast | null
  /** Calendar days the owner's forecast is later (+) than the contractor's date */
  ownerGapDays: number | null
}

export interface PhaseSpan {
  phase: string
  start: string | null
  finish: string | null
  baselineStart: string | null
  baselineFinish: string | null
  /** Every mapped milestone of the phase has an actual date */
  done: boolean
  /** At least one milestone of the phase has an actual date */
  started: boolean
  varianceDays: number | null
}

export interface MasterRow {
  id: string
  name: string
  sector: string | null
  location: string | null
  contractor: string | null
  latest: UploadRef | null
  baseline: UploadRef | null
  previous: UploadRef | null
  status: DataStatus
  /** Days between the newest upload's data date and the day the master is read */
  ageDays: number | null
  cells: MasterCell[]
  phases: PhaseSpan[]
  /** The phase the project is in: the first phase that is not done */
  currentPhase: string | null
  mappedCount: number
  missingCount: number
  /** The last mapped milestone's date: when the project finishes on this master */
  finish: string | null
  finishVarianceDays: number | null
}

export interface SectorRollup {
  sector: string
  projects: number
  byStatus: Record<DataStatus, number>
  start: string | null
  finish: string | null
  /** Projects whose finish is later than its baseline */
  late: number
  worstVarianceDays: number | null
  /** Per dictionary milestone: how many projects have reached it, of how many mapped it */
  milestones: { key: string; achieved: number; mapped: number; latest: string | null }[]
  /** How many projects are in each phase */
  inPhase: Record<string, number>
}

export interface LookAheadItem {
  kind: 'milestone' | 'party'
  date: string
  projectId: string | null
  project: string
  sector: string | null
  what: string
  /** For a contractor milestone: the data status of its project. For another party's item: who owes it. */
  source: string
  daysOut: number
}

export interface PartyItem {
  id: string
  projectId: string | null
  party: string
  title: string
  needDate: string | null
  forecastDate: string | null
  actualDate: string | null
  note: string | null
  milestoneKey: string | null
  updatedAt: string
}

export type PartyStatus = 'done' | 'late' | 'due_soon' | 'open'

export interface PartyRow extends PartyItem {
  project: string | null
  sector: string | null
  status: PartyStatus
  /** Calendar days the forecast (or today, when there is none) is past the need date */
  lateDays: number | null
  /** The contractor milestone this item is needed for, and its date on the master */
  neededFor: { name: string; date: string | null } | null
}

export interface MasterSchedule {
  asOf: string
  dictionary: DictMilestone[]
  phases: string[]
  rows: MasterRow[]
  sectors: SectorRollup[]
  totals: { projects: number; byStatus: Record<DataStatus, number>; mapped: number; missing: number; late: number; finish: string | null }
  parties: PartyRow[]
}

/** A sensible first dictionary for a building program; every program edits its own. */
export const DEFAULT_DICTIONARY: DictMilestone[] = [
  { key: 'funds', name: 'Funds obligated', phase: 'Funding' },
  { key: 'design_start', name: 'Design start', phase: 'Design' },
  { key: 'design_done', name: 'Design complete', phase: 'Design' },
  { key: 'permit', name: 'Permit issued', phase: 'Permitting' },
  { key: 'ntp', name: 'Notice to proceed', phase: 'Construction' },
  { key: 'enclosed', name: 'Building enclosed', phase: 'Construction' },
  { key: 'substantial', name: 'Substantial completion', phase: 'Construction' },
  { key: 'occupancy', name: 'Occupancy', phase: 'Closeout' },
  { key: 'final', name: 'Final completion', phase: 'Closeout' },
]

/** Who, other than the contractor, owes the program something. Free text is allowed; these are the suggestions. */
export const PARTY_SUGGESTIONS = ['Owner', 'Funding agency', 'Designer', 'Permitting', 'Utility', 'Procurement', 'Operations and move-in'] as const

const DAY = 86_400_000
const day = (v: string | null | undefined): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
/** Calendar days from a to b (positive when b is later). */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY)
const minDay = (xs: (string | null)[]): string | null => xs.reduce<string | null>((m, x) => (x && (!m || x < m) ? x : m), null)
const maxDay = (xs: (string | null)[]): string | null => xs.reduce<string | null>((m, x) => (x && (!m || x > m) ? x : m), null)
const emptyStatus = (): Record<DataStatus, number> => ({ current: 0, provisional: 0, stale: 0, expired: 0, none: 0 })

/** The phases of a dictionary, in the order they first appear. */
export const phasesOf = (dictionary: DictMilestone[]): string[] => [...new Set(dictionary.map(m => m.phase))]

/**
 * The date a mapping reads from an activity, and whether it is an actual. A milestone activity has one date, so a
 * milestone that carries only its other date still answers.
 */
export function readDate(a: ActivityDates, use: 'start' | 'finish'): { date: string | null; actual: boolean } {
  const start = { date: day(a.actualStart) ?? day(a.earlyStart), actual: !!day(a.actualStart) }
  const finish = { date: day(a.actualFinish) ?? day(a.earlyFinish), actual: !!day(a.actualFinish) }
  const first = use === 'start' ? start : finish
  if (first.date || a.type !== 'milestone') return first
  return use === 'start' ? finish : start
}

/** The baseline date for the same mapping: from the baseline upload when the project has one, else the file's own target. */
function baselineDate(ref: MappedRef, latest: ActivityDates | undefined, base: ActivityDates | undefined, hasBaselineUpload: boolean): string | null {
  if (hasBaselineUpload) {
    if (!base) return null
    // A baseline upload's own early dates are the plan it set.
    const d = ref.use === 'start' ? day(base.earlyStart) ?? day(base.actualStart) : day(base.earlyFinish) ?? day(base.actualFinish)
    if (d || base.type !== 'milestone') return d
    return ref.use === 'start' ? day(base.earlyFinish) ?? day(base.actualFinish) : day(base.earlyStart) ?? day(base.actualStart)
  }
  if (!latest) return null
  const d = ref.use === 'start' ? day(latest.baselineStart) : day(latest.baselineFinish)
  if (d || latest.type !== 'milestone') return d
  return ref.use === 'start' ? day(latest.baselineFinish) : day(latest.baselineStart)
}

/** How current a project's data is on the day the master is read. */
export function dataStatus(latest: UploadRef | null, rejected: boolean, asOf: string): { status: DataStatus; ageDays: number | null } {
  if (!latest) return { status: 'none', ageDays: null }
  const from = day(latest.dataDate) ?? day(latest.uploadedAt)
  const ageDays = from ? Math.max(0, daysBetween(from, asOf)) : null
  if (ageDays !== null && ageDays > EXPIRED_AFTER_DAYS) return { status: 'expired', ageDays }
  if (ageDays !== null && ageDays > STALE_AFTER_DAYS) return { status: 'stale', ageDays }
  if (rejected) return { status: 'provisional', ageDays }
  return { status: 'current', ageDays }
}

function buildRow(p: ProjectInput, dictionary: DictMilestone[], phases: string[], asOf: string): MasterRow {
  const { status, ageDays } = dataStatus(p.latest, p.latestRejected, asOf)
  const cells: MasterCell[] = dictionary.map(m => {
    const ref = p.mapping[m.key] ?? null
    const of = p.ownerForecasts[m.key] ?? null
    const a = ref && p.latest ? p.latestActs[ref.code] : undefined
    if (!ref || !a) {
      return { key: m.key, mapped: ref, missing: !!ref && !!p.latest, activityName: null, date: null, actual: false, baseline: null, previous: null,
        varianceDays: null, movedDays: null, totalFloat: null, critical: false, ownerForecast: of, ownerGapDays: null }
    }
    const { date, actual } = readDate(a, ref.use)
    const baseline = baselineDate(ref, a, p.baselineActs[ref.code], !!p.baseline && p.baseline.id !== p.latest?.id)
    const prevAct = p.previous ? p.previousActs[ref.code] : undefined
    const previous = prevAct ? readDate(prevAct, ref.use).date : null
    return {
      key: m.key, mapped: ref, missing: false, activityName: a.name, date, actual, baseline, previous,
      varianceDays: date && baseline ? daysBetween(baseline, date) : null,
      movedDays: date && previous ? daysBetween(previous, date) : null,
      totalFloat: actual ? null : a.totalFloat, critical: !actual && a.isCritical,
      ownerForecast: of, ownerGapDays: of && date ? daysBetween(date, of.date) : null,
    }
  })
  const byKey = new Map(cells.map(c => [c.key, c]))
  const spans: PhaseSpan[] = phases.map(phase => {
    const own = dictionary.filter(m => m.phase === phase).map(m => byKey.get(m.key)!).filter(c => c.mapped && !c.missing)
    const start = minDay(own.map(c => c.date)), finish = maxDay(own.map(c => c.date))
    const baselineStart = minDay(own.map(c => c.baseline)), baselineFinish = maxDay(own.map(c => c.baseline))
    const dated = own.filter(c => c.date)
    return { phase, start, finish, baselineStart, baselineFinish,
      done: dated.length > 0 && dated.length === own.length && dated.every(c => c.actual), started: dated.some(c => c.actual),
      varianceDays: finish && baselineFinish ? daysBetween(baselineFinish, finish) : null }
  })
  const withDates = spans.filter(s => s.start || s.finish)
  const currentPhase = withDates.find(s => !s.done)?.phase ?? (withDates.length ? withDates[withDates.length - 1].phase : null)
  const last = [...cells].reverse().find(c => c.date)
  return {
    id: p.id, name: p.name, sector: p.sector, location: p.location, contractor: p.contractor,
    latest: p.latest, baseline: p.baseline, previous: p.previous, status, ageDays, cells, phases: spans, currentPhase,
    mappedCount: cells.filter(c => c.mapped).length, missingCount: cells.filter(c => c.missing).length,
    finish: last?.date ?? null, finishVarianceDays: last?.varianceDays ?? null,
  }
}

function rollup(sector: string, rows: MasterRow[], dictionary: DictMilestone[], phases: string[]): SectorRollup {
  const byStatus = emptyStatus()
  for (const r of rows) byStatus[r.status]++
  const variances = rows.map(r => r.finishVarianceDays).filter((v): v is number => v !== null)
  const inPhase: Record<string, number> = Object.fromEntries(phases.map(p => [p, 0]))
  for (const r of rows) if (r.currentPhase) inPhase[r.currentPhase]++
  return {
    sector, projects: rows.length, byStatus,
    start: minDay(rows.flatMap(r => r.cells.map(c => c.date))), finish: maxDay(rows.map(r => r.finish)),
    late: variances.filter(v => v > 0).length, worstVarianceDays: variances.length ? Math.max(...variances) : null,
    milestones: dictionary.map((m, i) => {
      const cs = rows.map(r => r.cells[i]).filter(c => c.mapped && !c.missing)
      return { key: m.key, achieved: cs.filter(c => c.actual).length, mapped: cs.length, latest: maxDay(cs.map(c => c.date)) }
    }),
    inPhase,
  }
}

/** How late or how close another party's item is on the day the master is read. */
export function partyStatus(item: Pick<PartyItem, 'needDate' | 'forecastDate' | 'actualDate'>, asOf: string): { status: PartyStatus; lateDays: number | null } {
  if (item.actualDate) return { status: 'done', lateDays: item.needDate ? Math.max(0, daysBetween(item.needDate, item.actualDate)) || null : null }
  const expected = item.forecastDate ?? null
  if (item.needDate) {
    // Late when it is forecast after it is needed, or when the need date has passed with nothing delivered.
    const late = Math.max(expected ? daysBetween(item.needDate, expected) : 0, daysBetween(item.needDate, asOf))
    if (late > 0) return { status: 'late', lateDays: late }
  }
  const next = expected ?? item.needDate
  if (next && next < asOf) return { status: 'late', lateDays: daysBetween(next, asOf) }
  if (next && daysBetween(asOf, next) <= 30) return { status: 'due_soon', lateDays: null }
  return { status: 'open', lateDays: null }
}

export const NO_SECTOR = 'No sector'

/** Builds the whole master from the program's dictionary, its projects and the other parties' items. */
export function buildMaster(input: { dictionary: DictMilestone[]; projects: ProjectInput[]; parties: PartyItem[]; asOf: string }): MasterSchedule {
  const { dictionary, asOf } = input
  const phases = phasesOf(dictionary)
  const rows = input.projects.map(p => buildRow(p, dictionary, phases, asOf))
  const sectorNames = [...new Set(rows.map(r => r.sector ?? NO_SECTOR))].sort((a, b) => (a === NO_SECTOR ? 1 : b === NO_SECTOR ? -1 : a.localeCompare(b)))
  const sectors = sectorNames.map(s => rollup(s, rows.filter(r => (r.sector ?? NO_SECTOR) === s), dictionary, phases))
  const byStatus = emptyStatus()
  for (const r of rows) byStatus[r.status]++
  const rowById = new Map(rows.map(r => [r.id, r]))
  const nameOf = new Map(dictionary.map((m, i) => [m.key, { name: m.name, i }]))
  const parties: PartyRow[] = input.parties
    // An item filed under a project the reader cannot see is not shown.
    .filter(it => !it.projectId || rowById.has(it.projectId))
    .map(it => {
      const row = it.projectId ? rowById.get(it.projectId)! : null
      const m = it.milestoneKey ? nameOf.get(it.milestoneKey) : undefined
      return { ...it, project: row?.name ?? null, sector: row?.sector ?? null, ...partyStatus(it, asOf),
        neededFor: m ? { name: m.name, date: row ? row.cells[m.i].date : null } : null }
    })
    .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || (a.needDate ?? a.forecastDate ?? '9999').localeCompare(b.needDate ?? b.forecastDate ?? '9999'))
  return {
    asOf, dictionary, phases, rows, sectors, parties,
    totals: { projects: rows.length, byStatus, mapped: rows.reduce((n, r) => n + r.mappedCount, 0), missing: rows.reduce((n, r) => n + r.missingCount, 0),
      late: rows.filter(r => (r.finishVarianceDays ?? 0) > 0).length, finish: maxDay(rows.map(r => r.finish)) },
  }
}

/** What is due in the next `days` days: contractor milestones not yet reached, and other parties' open items. */
export function lookAhead(master: MasterSchedule, days = 90): LookAheadItem[] {
  const out: LookAheadItem[] = []
  const end = new Date(Date.parse(master.asOf + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10)
  for (const r of master.rows) {
    r.cells.forEach((c, i) => {
      if (!c.date || c.actual || c.date > end) return
      out.push({ kind: 'milestone', date: c.date, projectId: r.id, project: r.name, sector: r.sector, what: master.dictionary[i].name,
        source: `Contractor schedule, ${DATA_STATUS_LABEL[r.status].toLowerCase()}`, daysOut: daysBetween(master.asOf, c.date) })
    })
  }
  for (const p of master.parties) {
    if (p.status === 'done') continue
    const d = p.forecastDate ?? p.needDate
    if (!d || d > end) continue
    out.push({ kind: 'party', date: d, projectId: p.projectId, project: p.project ?? 'Whole program', sector: p.sector, what: p.title, source: p.party, daysOut: daysBetween(master.asOf, d) })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.project.localeCompare(b.project))
}

/* ─── Suggesting a mapping ───────────────── */

const STOP = new Set(['the', 'of', 'and', 'for', 'to', 'a', 'an', 'in', 'on'])
const SYNONYMS: [RegExp, string][] = [
  [/\bntp\b/g, 'notice proceed'], [/\bsubst?\.?\s*compl?\w*/g, 'substantial completion'], [/\bsc\b/g, 'substantial completion'],
  [/\bco\b|\bc\s*of\s*o\b|certificate of occupancy/g, 'occupancy'], [/\bdry[\s-]?in\b|weather\s*tight|watertight/g, 'building enclosed'],
  [/\bcompleted?\b|\bcompletion\b/g, 'complete'], [/\bfinish(ed)?\b|\bend\b/g, 'complete'], [/\bbegin\b|\bcommence\w*\b/g, 'start'],
]
function tokens(s: string): Set<string> {
  let t = ` ${s.toLowerCase()} `
  for (const [re, to] of SYNONYMS) t = t.replace(re, ` ${to} `)
  return new Set(t.split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)))
}

/**
 * For each dictionary milestone not yet mapped, the activity whose name is closest to the milestone's name. A
 * suggestion is only a starting point: nothing is mapped until a person accepts it. Milestone activities win ties.
 */
export function suggestMapping(dictionary: DictMilestone[], activities: Pick<ActivityDates, 'code' | 'name' | 'type' | 'milestoneKind'>[], existing: Record<string, MappedRef> = {}): Record<string, MappedRef & { name: string }> {
  const out: Record<string, MappedRef & { name: string }> = {}
  const acts = activities.filter(a => a.code && a.name).map(a => ({ a, t: tokens(a.name) }))
  for (const m of dictionary) {
    if (existing[m.key]) continue
    const want = tokens(m.name)
    if (!want.size) continue
    let best: { a: (typeof acts)[number]['a']; score: number } | null = null
    for (const { a, t } of acts) {
      let hit = 0
      for (const w of want) if (t.has(w)) hit++
      if (hit < want.size) continue
      // Every word of the milestone is in the activity name; fewer extra words and a milestone activity score higher.
      const score = hit / t.size + (a.type === 'milestone' ? 0.5 : 0)
      if (!best || score > best.score) best = { a, score }
    }
    if (best) {
      const startish = /\bstart\b|\bproceed\b/.test([...want].join(' '))
      out[m.key] = { code: best.a.code, name: best.a.name, use: best.a.milestoneKind === 'start' ? 'start' : best.a.milestoneKind === 'finish' ? 'finish' : startish ? 'start' : 'finish' }
    }
  }
  return out
}

/** The most standard milestones a master built from the schedules themselves starts with. */
export const MAX_AUTO_MILESTONES = 12
export const OTHER_PHASE = 'Milestones'

/**
 * The standard milestones for a master built from a group of schedules. It keeps the standard list's milestones
 * that at least one schedule has, in their order, then adds the milestones the schedules themselves share: a
 * milestone activity name found in at least half of them (in the only one, when there is one), most shared and
 * earliest first. With no milestone activity anywhere, the standard list is returned as it is.
 */
export function dictionaryFromSchedules(perProject: Pick<ActivityDates, 'code' | 'name' | 'type' | 'milestoneKind' | 'earlyFinish' | 'earlyStart' | 'actualFinish' | 'actualStart'>[][], standard: DictMilestone[], newKey: () => string): DictMilestone[] {
  const projects = perProject.filter(p => p.length)
  if (!projects.length) return standard
  const suggested = projects.map(acts => suggestMapping(standard, acts))
  const kept = standard.filter(m => suggested.some(sg => sg[m.key]))
  const norm = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ')
  const seen = new Map<string, { name: string; count: number; first: string }>()
  projects.forEach((acts, i) => {
    const taken = new Set(Object.values(suggested[i]).map(v => v.code))
    const mine = new Set<string>()
    for (const a of acts) {
      if (a.type !== 'milestone' || taken.has(a.code) || !a.name.trim()) continue
      const k = norm(a.name)
      if (mine.has(k)) continue
      mine.add(k)
      const when = (a.actualFinish ?? a.earlyFinish ?? a.actualStart ?? a.earlyStart ?? '9999').slice(0, 10)
      const e = seen.get(k)
      if (e) { e.count++; if (when < e.first) e.first = when } else seen.set(k, { name: a.name.trim().replace(/\s+/g, ' ').slice(0, 80), count: 1, first: when })
    }
  })
  const need = Math.max(1, Math.ceil(projects.length / 2))
  const names = new Set(kept.map(m => m.name.toLowerCase()))
  const extra = [...seen.values()].filter(e => e.count >= need && !names.has(e.name.toLowerCase()))
    .sort((x, y) => y.count - x.count || x.first.localeCompare(y.first))
    .slice(0, Math.max(0, MAX_AUTO_MILESTONES - kept.length))
    .sort((x, y) => x.first.localeCompare(y.first))
  const out = [...kept, ...extra.map(e => ({ key: newKey(), name: e.name, phase: OTHER_PHASE }))]
  return out.length ? out : standard
}

/* ─── Printouts as tables (for the CSV download) ───────────────── */

export type MasterReport = 'milestones' | 'phases' | 'sectors' | 'lookahead' | 'parties' | 'updates'
export const MASTER_REPORTS: MasterReport[] = ['milestones', 'phases', 'sectors', 'lookahead', 'parties', 'updates']

const signed = (n: number | null) => (n === null ? '' : n > 0 ? `+${n}` : String(n))

/** One printout as rows of cells; dates are formatted by the caller's `fmt`. */
export function reportTable(master: MasterSchedule, report: MasterReport, fmt: (d: string | null) => string): string[][] {
  const { dictionary, rows } = master
  const source = (r: MasterRow) => (r.latest ? `${r.latest.version}${r.latest.dataDate ? `, data date ${fmt(r.latest.dataDate)}` : ''}` : '')
  if (report === 'milestones') {
    const out = [['Sector', 'Project', 'Contractor', 'Milestone', 'Phase', 'Contractor activity', 'Baseline', 'Previous update', 'Current', 'Actual or forecast',
      'Days against baseline', 'Days moved since previous', 'Owner forecast', 'Owner forecast note', 'Source', 'Data status']]
    for (const r of rows) r.cells.forEach((c, i) => {
      if (!c.mapped && !c.ownerForecast) return
      out.push([r.sector ?? '', r.name, r.contractor ?? '', dictionary[i].name, dictionary[i].phase,
        c.mapped ? (c.missing ? `${c.mapped.code} (not in the newest upload)` : `${c.mapped.code} ${c.activityName ?? ''}`.trim()) : '',
        fmt(c.baseline), fmt(c.previous), fmt(c.date), c.date ? (c.actual ? 'Actual' : 'Forecast') : '', signed(c.varianceDays), signed(c.movedDays),
        fmt(c.ownerForecast?.date ?? null), c.ownerForecast?.note ?? '', source(r), DATA_STATUS_LABEL[r.status]])
    })
    return out
  }
  if (report === 'phases') {
    const out = [['Sector', 'Project', 'Phase', 'Baseline start', 'Baseline finish', 'Start', 'Finish', 'Days against baseline', 'State', 'Source', 'Data status']]
    for (const r of rows) for (const s of r.phases) {
      if (!s.start && !s.finish) continue
      out.push([r.sector ?? '', r.name, s.phase, fmt(s.baselineStart), fmt(s.baselineFinish), fmt(s.start), fmt(s.finish), signed(s.varianceDays),
        s.done ? 'Complete' : s.started ? 'Under way' : 'Not started', source(r), DATA_STATUS_LABEL[r.status]])
    }
    return out
  }
  if (report === 'sectors') {
    const out = [['Sector', 'Projects', 'Current', 'Not accepted', 'Stale', 'Expired', 'No schedule', 'Earliest date', 'Latest finish', 'Projects later than baseline', 'Worst days against baseline',
      ...dictionary.map(m => `${m.name}: reached of mapped`)]]
    for (const s of master.sectors) {
      out.push([s.sector, String(s.projects), String(s.byStatus.current), String(s.byStatus.provisional), String(s.byStatus.stale), String(s.byStatus.expired), String(s.byStatus.none),
        fmt(s.start), fmt(s.finish), String(s.late), signed(s.worstVarianceDays), ...s.milestones.map(m => `${m.achieved} of ${m.mapped}`)])
    }
    return out
  }
  if (report === 'lookahead') {
    return [['Date', 'Days from today', 'Sector', 'Project', 'What', 'Who or source'],
      ...lookAhead(master).map(i => [fmt(i.date), String(i.daysOut), i.sector ?? '', i.project, i.what, i.source])]
  }
  if (report === 'parties') {
    return [['Party', 'Item', 'Sector', 'Project', 'Needed by', 'Forecast', 'Actual', 'State', 'Days late', 'Needed for', 'Note'],
      ...master.parties.map(p => [p.party, p.title, p.sector ?? '', p.project ?? 'Whole program', fmt(p.needDate), fmt(p.forecastDate), fmt(p.actualDate),
        p.status === 'done' ? 'Done' : p.status === 'late' ? 'Late' : p.status === 'due_soon' ? 'Due soon' : 'Open', p.lateDays ? String(p.lateDays) : '',
        p.neededFor ? `${p.neededFor.name}${p.neededFor.date ? ` (${fmt(p.neededFor.date)})` : ''}` : '', p.note ?? ''])]
  }
  return [['Sector', 'Project', 'Contractor', 'Newest upload', 'Data date', 'Days old', 'Data status', 'Baseline upload', 'Milestones mapped', 'Mapped but not in the newest upload'],
    ...rows.map(r => [r.sector ?? '', r.name, r.contractor ?? '', r.latest?.version ?? '', fmt(r.latest?.dataDate ?? null), r.ageDays === null ? '' : String(r.ageDays),
      DATA_STATUS_LABEL[r.status], r.baseline?.version ?? '', `${r.mappedCount} of ${dictionary.length}`, String(r.missingCount)])]
}

/* ─── Validating what a person typed ───────────────── */

const clean = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null)
/** A real calendar day (2027-02-30 is not one, although Date.parse rolls it into March). */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const t = Date.parse(v + 'T00:00:00Z')
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v
}

export const MAX_DICTIONARY = 40
export const MAX_PROGRAM_PROJECTS = 200
export const MAX_PARTY_ITEMS = 1000

/** A dictionary as sent by the page: names and phases; keys are kept when sent and made when new. */
export function parseDictionary(raw: unknown, newKey: () => string): { dictionary: DictMilestone[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Send the milestones as a list.' }
  if (raw.length > MAX_DICTIONARY) return { error: `A program can have up to ${MAX_DICTIONARY} standard milestones.` }
  const out: DictMilestone[] = [], seen = new Set<string>(), names = new Set<string>()
  for (const r of raw) {
    const o = (r ?? {}) as Record<string, unknown>
    const name = clean(o.name, 80), phase = clean(o.phase, 40)
    if (!name) return { error: 'Every milestone needs a name.' }
    if (!phase) return { error: `Give "${name}" a phase.` }
    if (names.has(name.toLowerCase())) return { error: `"${name}" is listed twice.` }
    names.add(name.toLowerCase())
    let key = typeof o.key === 'string' && /^[a-z0-9_-]{1,40}$/.test(o.key) ? o.key : newKey()
    while (seen.has(key)) key = newKey()
    seen.add(key)
    out.push({ key, name, phase })
  }
  return { dictionary: out }
}

/** A mapping as sent by the page: milestone key → { code, use }; a null entry removes it. Unknown keys are refused. */
export function parseMapping(raw: unknown, dictionary: DictMilestone[], current: Record<string, MappedRef>): { mapping: Record<string, MappedRef> } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Send the mapping as an object.' }
  const keys = new Set(dictionary.map(m => m.key))
  const next = { ...current }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.has(k)) return { error: 'That milestone is not in this program.' }
    if (v === null) { delete next[k]; continue }
    const o = (v ?? {}) as Record<string, unknown>
    const code = clean(o.code, 120)
    if (!code) return { error: 'Choose an activity.' }
    next[k] = { code, use: o.use === 'start' ? 'start' : 'finish' }
  }
  return { mapping: next }
}

/** Owner forecasts as sent by the page: milestone key → { date, note }; a null entry removes it. */
export function parseOwnerForecasts(raw: unknown, dictionary: DictMilestone[], current: Record<string, OwnerForecast>, by: string | null, at: string): { ownerForecasts: Record<string, OwnerForecast> } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Send the forecasts as an object.' }
  const keys = new Set(dictionary.map(m => m.key))
  const next = { ...current }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.has(k)) return { error: 'That milestone is not in this program.' }
    if (v === null) { delete next[k]; continue }
    const o = (v ?? {}) as Record<string, unknown>
    if (!isDay(o.date)) return { error: 'Give the owner forecast a date.' }
    next[k] = { date: o.date, note: clean(o.note, 300), by, at }
  }
  return { ownerForecasts: next }
}

export interface PartyFields { party?: string; title?: string; projectId?: string | null; needDate?: string | null; forecastDate?: string | null; actualDate?: string | null; note?: string | null; milestoneKey?: string | null }

/** Validates a new item (all = true) or a change to one. */
export function parsePartyFields(b: Record<string, unknown>, all: boolean, dictionary: DictMilestone[]): { fields: PartyFields } | { error: string } {
  const f: PartyFields = {}
  if (all || b.party !== undefined) {
    const p = clean(b.party, 60)
    if (!p) return { error: 'Say who owes this (for example the funding agency or the utility).' }
    f.party = p
  }
  if (all || b.title !== undefined) {
    const t = clean(b.title, 200)
    if (!t || t.length < 3) return { error: 'Describe the item (at least 3 characters).' }
    f.title = t
  }
  for (const k of ['needDate', 'forecastDate', 'actualDate'] as const) {
    if (b[k] === undefined) continue
    if (b[k] === null || b[k] === '') f[k] = null
    else if (isDay(b[k])) f[k] = b[k] as string
    else return { error: 'Dates must be real calendar dates.' }
  }
  if (b.note !== undefined) f.note = clean(b.note, 500)
  if (b.projectId !== undefined) f.projectId = typeof b.projectId === 'string' && b.projectId ? b.projectId : null
  if (b.milestoneKey !== undefined) {
    if (b.milestoneKey === null || b.milestoneKey === '') f.milestoneKey = null
    else if (dictionary.some(m => m.key === b.milestoneKey)) f.milestoneKey = b.milestoneKey as string
    else return { error: 'That milestone is not in this program.' }
  }
  return { fields: f }
}

export const cleanText = clean
