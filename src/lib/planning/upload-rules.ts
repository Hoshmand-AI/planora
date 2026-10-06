// Rules applied when a schedule is uploaded or re-tagged: progress mode from the file, firm-history
// inclusion, and update-series consistency. Pure (dates in text are MM/DD/YYYY), so unit tested.

import type { ProgressMode } from './types'
import { historyInclusionWarning, isAsBuilt, type UploadOrigin } from './history-selection'
import { fmtDate } from '@/lib/format'

const MODE_LABEL: Record<ProgressMode, string> = { retained: 'Retained Logic', override: 'Progress Override' }

/**
 * Progress mode for an upload: the scheduler's explicit choice, else the file's own P6 setting
 * (SCHEDOPTIONS), else Retained Logic (P6's default). Warns when the choice differs from the file.
 */
export function resolveProgressMode(chosen: ProgressMode | null | undefined, fileMode: ProgressMode | null | undefined): { mode: ProgressMode; warning: string | null } {
  if (chosen && fileMode && chosen !== fileMode) {
    return { mode: chosen, warning: progressModeWarning(chosen, fileMode) }
  }
  return { mode: chosen ?? fileMode ?? 'retained', warning: null }
}

/** Warning when the progress mode Planora schedules with differs from the file's own setting (null when not). */
export function progressModeWarning(chosen: ProgressMode, fileMode: ProgressMode | null | undefined): string | null {
  if (!fileMode || chosen === fileMode) return null
  return `The file was scheduled in P6 with ${MODE_LABEL[fileMode]}, but Planora is scheduling it with ${MODE_LABEL[chosen]}, so out-of-sequence work and float can differ from P6. The P6 export carries the ${MODE_LABEL[chosen]} setting.`
}

export interface HistoryDecision {
  inHistory: boolean
  historyOverride: boolean
  warnings: string[]
}

/**
 * Whether an upload calibrates firm history:
 *  - a re-imported Planora export or a third-party schedule: never by default;
 *  - otherwise as-built schedules (every activity except LOE / WBS summaries has an actual finish) by default;
 *  - an explicit inHistory=true on a schedule that is not as-built is kept with a warning, and only
 *    counts when `override` is also set (the explicit "include anyway").
 */
export function decideHistory(input: {
  requested: boolean | null
  override?: boolean
  origin: UploadOrigin | null
  planoraExport: boolean
  workCount: number
  openCount: number
}): HistoryDecision {
  const warnings: string[] = []
  const asBuilt = isAsBuilt(input)
  if (input.planoraExport) {
    warnings.push('This file is a Planora export re-imported (it was produced by Planora), so it is not used for firm history: its durations are Planora\'s own, not the project\'s record.')
    return { inHistory: false, historyOverride: false, warnings }
  }
  if (input.origin === 'third_party') {
    if (input.requested) warnings.push('Third-party schedules do not calibrate firm history; only your own projects do. It was left out of firm history.')
    return { inHistory: false, historyOverride: false, warnings }
  }
  const inHistory = input.requested ?? asBuilt
  const historyOverride = inHistory && !asBuilt && !!input.override
  if (inHistory && !asBuilt) {
    const w = historyInclusionWarning(input, historyOverride)
    if (w) warnings.push(w)
  }
  return { inHistory, historyOverride, warnings }
}

interface SeriesMember { id: string; version: string; dataDate: string | null; uploadedAt: string; projectType: string | null; region: string | null; grossSqft: number | null }

/** Latest upload of the series (by upload time) other than `exceptId`. */
const latestOf = (series: SeriesMember[], exceptId?: string) =>
  series.filter(s => s.id !== exceptId).reduce<SeriesMember | null>((m, s) => (!m || Date.parse(s.uploadedAt) > Date.parse(m.uploadedAt) ? s : m), null)

/**
 * Project tags for a new upload of a series: what the upload states, else what the latest earlier
 * upload of the same project carries (a later update rarely repeats the facility type).
 */
export function inheritSeriesProfile(series: SeriesMember[], given: { projectType: string | null; region: string | null; grossSqft: number | null }): { projectType: string | null; region: string | null; grossSqft: number | null; inherited: string[] } {
  const prev = latestOf(series)
  const inherited: string[] = []
  const pick = <T>(k: 'projectType' | 'region' | 'grossSqft', v: T | null): T | null => {
    if (v !== null && v !== undefined && v !== '') return v
    const p = prev?.[k] as T | null | undefined
    if (p !== null && p !== undefined) { inherited.push(k); return p }
    return null
  }
  return { projectType: pick('projectType', given.projectType), region: pick('region', given.region), grossSqft: pick('grossSqft', given.grossSqft), inherited }
}

/**
 * Warning when a new upload's data date is earlier than (or equal to) one already in the series: the
 * series is read in data-date order, so an out-of-order upload changes which update is "previous".
 */
export function seriesDataDateWarning(series: SeriesMember[], dataDate: string | null, version: string): string | null {
  if (!dataDate) return null
  const later = series.filter(s => s.dataDate && s.dataDate.slice(0, 10) > dataDate.slice(0, 10))
  if (later.length) {
    const top = later.reduce((m, s) => (s.dataDate! > m.dataDate! ? s : m))
    return `Out of order: this upload's data date ${fmtDate(dataDate)} is earlier than ${later.length === 1 ? `"${top.version}"` : `${later.length} uploads already in this series (latest "${top.version}"`} (data date ${fmtDate(top.dataDate)}${later.length === 1 ? '' : ')'}). The series is ordered by data date, so "${version}" sits before ${later.length === 1 ? 'it' : 'them'} in comparisons and trends; check the version label and data date.`
  }
  const same = series.find(s => s.dataDate && s.dataDate.slice(0, 10) === dataDate.slice(0, 10))
  if (same) return `"${same.version}" in this series has the same data date (${fmtDate(dataDate)}); comparisons between them show no progress period.`
  return null
}
