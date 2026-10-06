// Which uploads may calibrate firm history (as-built, one per project, no Planora re-imports, no
// third-party schedules). Dependency-free so db.getOrgHistory can apply it. Pure, unit tested.

/* ─── Which uploads may calibrate firm history ───────── */

/** Where an upload came from: the firm's own project, or a schedule it reviews for someone else. */
export type UploadOrigin = 'own' | 'third_party'

/** One upload considered for firm history (see db.getOrgHistory). */
export interface HistoryCandidate {
  id: string
  name?: string
  version?: string
  /** Update series (P6 project short name / MSP title); null = its own series */
  projectKey: string | null
  dataDate: string | null
  uploadedAt: string
  /** The scheduler included it (schedules.in_history) */
  inHistory: boolean
  /** Explicitly included although not every activity has an actual finish */
  historyOverride: boolean
  /** The file is Planora's own export re-imported, not the project's record */
  planoraExport: boolean
  uploadOrigin?: UploadOrigin | null
  /** Activities other than level of effort and WBS summaries */
  workCount: number
  /** ...of which have no actual finish */
  openCount: number
}

export type HistoryExclusion = 'not_included' | 'third_party' | 'not_as_built' | 'planora_export' | 'superseded' | 'org_opt_out' | 'empty'

export interface HistorySelection {
  /** Upload ids whose actuals calibrate firm history (one per project) */
  included: string[]
  excluded: { id: string; reason: HistoryExclusion; detail: string }[]
}

/** As-built: every activity except level of effort and WBS summaries has an actual finish. */
export const isAsBuilt = (c: { workCount: number; openCount: number }) => c.workCount > 0 && c.openCount === 0

/**
 * Pick the uploads that calibrate firm history:
 *  - only as-built schedules, unless the scheduler explicitly overrode that for an upload;
 *  - never a re-imported Planora export (it would teach Planora its own durations) or a third-party schedule;
 *  - one project counts once across its update series: the latest as-built upload by data date
 *    (then upload time) stands for the project; earlier updates are superseded;
 *  - nothing when the organization turned firm history off for its uploads.
 */
export function selectHistorySchedules(cands: HistoryCandidate[], opts: { orgOptOut?: boolean } = {}): HistorySelection {
  const excluded: HistorySelection['excluded'] = []
  if (opts.orgOptOut) {
    return { included: [], excluded: cands.map(c => ({ id: c.id, reason: 'org_opt_out' as const, detail: 'Your organization does not use its uploads for firm history (Organization settings).' })) }
  }
  const eligible: HistoryCandidate[] = []
  for (const c of cands) {
    if (!c.inHistory) excluded.push({ id: c.id, reason: 'not_included', detail: 'Not marked for firm history.' })
    else if (c.uploadOrigin === 'third_party') excluded.push({ id: c.id, reason: 'third_party', detail: 'A third-party schedule, not one of your own projects.' })
    else if (c.planoraExport) excluded.push({ id: c.id, reason: 'planora_export', detail: 'A re-imported Planora export: its durations are Planora\'s own, not the project\'s record.' })
    else if (c.workCount === 0) excluded.push({ id: c.id, reason: 'empty', detail: 'No activities to learn from.' })
    else if (!isAsBuilt(c) && !c.historyOverride) excluded.push({ id: c.id, reason: 'not_as_built', detail: `Not as-built: ${c.openCount} of ${c.workCount} activities have no actual finish.` })
    else eligible.push(c)
  }
  // One project once: the latest upload of each series (as-built ones before overridden partial ones).
  const later = (a: HistoryCandidate, b: HistoryCandidate) => {
    const ab = isAsBuilt(a) ? 1 : 0, bb = isAsBuilt(b) ? 1 : 0
    if (ab !== bb) return ab - bb
    const ad = a.dataDate ?? '', bd = b.dataDate ?? ''
    if (ad !== bd) return ad < bd ? -1 : 1
    return Date.parse(a.uploadedAt) - Date.parse(b.uploadedAt)
  }
  const bySeries = new Map<string, HistoryCandidate[]>()
  for (const c of eligible) {
    const key = c.projectKey ? `k:${c.projectKey}` : `id:${c.id}`
    bySeries.set(key, [...(bySeries.get(key) ?? []), c])
  }
  const included: string[] = []
  for (const list of bySeries.values()) {
    const best = list.reduce((m, c) => (later(c, m) > 0 ? c : m))
    included.push(best.id)
    for (const c of list) {
      if (c !== best) excluded.push({ id: c.id, reason: 'superseded', detail: `Same project as ${best.name ? `"${best.name}"` : 'a later upload'}${best.version ? ` (${best.version})` : ''}, which stands for it in firm history.` })
    }
  }
  return { included, excluded }
}

/**
 * Warning for a schedule marked for firm history that is not as-built (null when there is nothing to say).
 * Without the explicit override its actuals are not used.
 */
export function historyInclusionWarning(c: { workCount: number; openCount: number }, override: boolean): string | null {
  if (isAsBuilt(c)) return null
  return override
    ? `This schedule is not as-built (${c.openCount} of ${c.workCount} activities have no actual finish), but it was included in firm history anyway; its partial actuals will calibrate durations.`
    : `This schedule is not as-built (${c.openCount} of ${c.workCount} activities have no actual finish), so firm history will not use it. Only finished projects calibrate firm history; include it anyway only if its completed work is representative.`
}
