// The import warning that compares the file's own finish dates and float with Planora's
// recalculation. Only fields that actually differ by more than one day are listed. Pure, so it is
// unit tested.

import type { RecalcDifference } from './schedule-analysis'
import { fmtDate } from '@/lib/format'

const DAY = 86_400_000
const dayGap = (a: string, b: string) => Math.abs(Math.round((Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / DAY))

/** The fields of one differing activity that differ by more than 1 day, in plain words; empty when none do. */
export function describeDifference(d: RecalcDifference): string {
  const parts: string[] = []
  const date = (label: string, f: string | null | undefined, p: string | null | undefined) => {
    if (f && p && dayGap(f, p) > 1) parts.push(`${label} file ${fmtDate(f)} / Planora ${fmtDate(p)}`)
  }
  date('start', d.fileStart, d.planoraStart)
  date('finish', d.fileFinish, d.planoraFinish)
  date('late start', d.fileLateStart, d.planoraLateStart)
  date('late finish', d.fileLateFinish, d.planoraLateFinish)
  if (d.fileFloat != null && d.planoraFloat != null && Math.abs(d.fileFloat - d.planoraFloat) > 1) parts.push(`float file ${d.fileFloat}d / Planora ${d.planoraFloat}d`)
  return parts.length ? `${d.code}: ${parts.join(', ')}` : ''
}

/** Notes about how Planora calculated the dates (src/lib/planning/complete-schedule.ts). */
const CALC_NOTE = /^(Planora recalculated all|The file did not include calculated dates|This file has no activity relationships|Planora could not recalculate)/
/** Notes that describe the file's own dates, only true when read from the uploaded file itself. */
const FILE_CALC_NOTE = /^(Planora recalculated all|The file did not include calculated dates)/
const DIFF_NOTE = /open activities have (a finish (date )?or total float|dates or total float) in the file that differs?/

/**
 * The import notes shown for a stored schedule: the notes recorded at upload, plus the calculation
 * note from this read only when upload recorded none (and, once Planora has analyzed the file, never
 * one that would describe Planora's stored dates as "the file's"). The file-vs-Planora comparison is
 * rebuilt from the stored samples so older uploads lose the misleading wording. No duplicates.
 */
export function importNotes(stored: string[], loadNote: string | null, analyzedBefore: boolean, recalc: Parameters<typeof recalcWarning>[0]): string[] {
  const out: string[] = []
  for (const w of stored) {
    const text = DIFF_NOTE.test(w) ? recalcWarning(recalc) : w
    if (text && !out.includes(text)) out.push(text)
  }
  if (loadNote && !out.some(w => CALC_NOTE.test(w)) && !(analyzedBefore && FILE_CALC_NOTE.test(loadNote))) out.unshift(loadNote)
  return out
}

export function recalcWarning(recalc: { compared: number; differing: number; samples: RecalcDifference[] } | null | undefined): string | null {
  if (!recalc || recalc.differing <= 0) return null
  const examples = recalc.samples.map(describeDifference).filter(Boolean).slice(0, 3)
  return `${recalc.differing} of ${recalc.compared} open activities have dates or total float in the file that differ from Planora's recalculation by more than 1 day${examples.length ? ` (e.g. ${examples.join('; ')})` : ''}; the QA/QC report lists every one.`
}
