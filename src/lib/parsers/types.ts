// Shared result type for all schedule-file parsers, plus small helpers the parsers share.

import type { Activity, Relationship } from '@/lib/db'
import type { ConstraintType, ProgressMode, WorkCalendar } from '@/lib/planning/types'
import type { EmbeddedBaseline } from '@/lib/analysis/baseline'
import type { ExceptionReport } from './exceptions'
import { randomUUID as uuid } from 'crypto'

export type ParsedSourceType = 'p6_xer' | 'p6_xml' | 'ms_xml' | 'pdf' | 'excel' | 'csv'

export interface ParsedSchedule {
  projectName: string
  dataDate: string | null
  projectStart: string | null
  /** Finish date the file reports (P6 scheduled finish / MSP finish); Planora recalculates its own */
  projectFinish: string | null
  /** Required finish the file imposes (P6 PROJECT.plan_end_date "Must Finish By") */
  mustFinishBy?: string | null
  /** Stable project identity across updates (P6 proj_short_name, MSP title) */
  projectKey?: string | null
  /** Activity.id is a fresh uuid; Activity.sourceId is the source-system id (P6 task_id, MSP UID, row code) */
  activities: Activity[]
  /** predecessorId / successorId reference Activity.id (uuid) */
  relationships: Relationship[]
  calendars: WorkCalendar[]
  defaultCalendarId: string | null
  warnings: string[]
  /**
   * Structured import exception report: every table / field / element the parser saw but did not map,
   * and every value it converted or defaulted (src/lib/parsers/exceptions.ts). Stored with the upload.
   */
  exceptions?: ExceptionReport
  sourceType: ParsedSourceType
  /** P6 only: resource assignments per source task id (XER TASKRSRC rows / P6 XML ResourceAssignment); undefined when the file has none */
  resourceCounts?: Record<string, number>
  /** P6 only: every table present in the file */
  sourceTables?: string[]
  /** P6 only: the file's out-of-sequence progress option (SCHEDOPTIONS); null when absent or "Actual Dates" */
  progressMode?: ProgressMode | null
  /** The file was written by Planora's own exporter (a re-import of Planora output, not a project record) */
  planoraExport?: boolean
  /** P6 only: the project baseline exported in the same file (per-activity baseline by activity id) */
  embeddedBaseline?: EmbeddedBaseline | null
}

/* ─── helpers shared by the parsers (not part of the public contract) ─── */

/** Build an Activity with sensible defaults. */
export function makeActivity(scheduleId: string, fields: Partial<Activity>): Activity {
  return {
    id: uuid(),
    scheduleId,
    activityId: '',
    name: '',
    wbs: '',
    duration: 0,
    remainingDuration: 0,
    percentComplete: 0,
    earlyStart: null,
    earlyFinish: null,
    lateStart: null,
    lateFinish: null,
    actualStart: null,
    actualFinish: null,
    baselineStart: null,
    baselineFinish: null,
    totalFloat: 0,
    freeFloat: 0,
    isCritical: false,
    status: 'not_started',
    activityType: 'task',
    calendarId: null,
    constraintType: null,
    constraintDate: null,
    sourceId: null,
    ...fields,
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** yyyy-mm-dd from UTC components of a Date. */
export function isoFromUtcDate(d: Date): string | null {
  if (isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** Excel / P6 serial day number (days since 1899-12-30) → yyyy-mm-dd. */
export function serialToIso(serial: number): string | null {
  if (!isFinite(serial)) return null
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000
  return isoFromUtcDate(new Date(ms))
}

/** Extract the leading yyyy-mm-dd from "2026-03-02 08:00" / "2026-03-02T08:00:00" without timezone shifts. */
export function isoDatePrefix(s: string | undefined | null): string | null {
  if (!s) return null
  const m = s.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  const y = +m[1], mo = +m[2], d = +m[3]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  return `${y}-${pad2(mo)}-${pad2(d)}`
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoFromUtcDate(new Date(Date.UTC(y, m - 1, d + days)))!
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Map a human/P6/MSP constraint label to a ConstraintType. Returns null for ASAP/ALAP/none/unknown. */
export function constraintFromLabel(label: string | null | undefined): ConstraintType | 'ALAP' | null {
  if (!label) return null
  const n = label.toLowerCase().replace(/[^a-z]/g, '')
  if (!n || n === 'none' || n === 'asap' || n === 'assoonaspossible') return null
  if (n === 'alap' || n === 'aslateaspossible' || n === 'csalap') return 'ALAP'
  const table: Record<string, ConstraintType> = {
    snet: 'SNET', startnoearlierthan: 'SNET', startonorafter: 'SNET', csmsoa: 'SNET',
    snlt: 'SNLT', startnolaterthan: 'SNLT', startonorbefore: 'SNLT', csmsob: 'SNLT',
    fnet: 'FNET', finishnoearlierthan: 'FNET', finishonorafter: 'FNET', csmeoa: 'FNET',
    fnlt: 'FNLT', finishnolaterthan: 'FNLT', finishonorbefore: 'FNLT', csmeob: 'FNLT',
    // P6 "Start On" / "Finish On" (CS_MSO / CS_MEO) keep logic in charge; only the mandatory types overrule it.
    starton: 'SO', csmso: 'SO', finishon: 'FO', csmeo: 'FO',
    mso: 'MSO', muststarton: 'MSO', mandatorystart: 'MSO', csmandstart: 'MSO',
    mfo: 'MFO', mustfinishon: 'MFO', mandatoryfinish: 'MFO', csmandfin: 'MFO', csmandfinish: 'MFO',
  }
  return table[n] ?? null
}
