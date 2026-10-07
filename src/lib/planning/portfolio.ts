// Portfolio view: every plan and uploaded schedule in the organization on one screen, with the
// alerts a project controls lead looks for first (late against the required date, missed milestone
// targets, date conflicts, reviews, stale status updates). Pure, so it is unit tested.

import type { Plan, Schedule } from '@/lib/db'
import { elicit } from './elicitation'
import { reviewStatusOf, scheduleDateChecks } from './evaluation'
import { fmtDates } from '@/lib/format'

export type AlertSeverity = 'error' | 'warning' | 'info'
export interface PortfolioAlert { code: string; severity: AlertSeverity; text: string }

export interface PortfolioRow {
  kind: 'plan' | 'schedule'
  id: string
  name: string
  /** Where to open it in the app */
  href: string
  finish: string | null
  required: string | null
  /** Calendar days after the required date (positive = late) */
  gapDays: number | null
  readiness: number | null
  updatedAt: string
  status: 'on_track' | 'attention' | 'at_risk' | 'not_started' | 'complete'
  alerts: PortfolioAlert[]
  /** Uploaded schedules: how many updates of this project are on file (the row shows the latest) */
  updates?: number
  /** Uploaded schedules: the latest update's data date */
  dataDate?: string | null
  /** Uploaded schedules: what the variance was measured against (Planora's analysis) */
  varianceBasis?: string | null
}

export interface Portfolio {
  rows: PortfolioRow[]
  totals: { projects: number; atRisk: number; attention: number; onTrack: number; alerts: number }
}

const DAY = 86_400_000
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY)
const us = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`
/** Plans not touched in this many days are flagged as stale. */
export const STALE_PLAN_DAYS = 30
/** An uploaded schedule whose data date is older than this needs a status update. */
export const STALE_DATA_DATE_DAYS = 45

function statusOf(alerts: PortfolioAlert[], started: boolean): PortfolioRow['status'] {
  if (!started) return 'not_started'
  if (alerts.some(a => a.severity === 'error')) return 'at_risk'
  if (alerts.some(a => a.severity === 'warning')) return 'attention'
  return 'on_track'
}

export function planRow(p: Plan, today: string): PortfolioRow {
  const alerts: PortfolioAlert[] = []
  const g = p.generated
  const elic = elicit({ answers: p.answers }, { extraQuestions: p.extraQuestions, today })
  const finish = g?.cpm?.projectFinish ?? null
  const required = g?.mustFinishBy ?? null
  const gapDays = finish && required ? days(required, finish) : null
  if (!g) {
    alerts.push({ code: 'not_generated', severity: 'info', text: `Interview ${elic.readiness}% complete; no schedule generated yet.` })
  } else {
    if (gapDays != null && gapDays > 0) alerts.push({ code: 'late', severity: 'error', text: `Forecast finish ${us(finish!)} is ${gapDays} days after the required ${us(required!)}. Recovery options are on the plan.` })
    const late = scheduleDateChecks(g).filter(c => c.severity === 'error')
    if (late.length) alerts.push({ code: 'milestone_late', severity: 'error', text: `${late.length} milestone target${late.length > 1 ? 's are' : ' is'} forecast late.` })
    const near = Object.values(g.cpm?.times || {}).filter(t => t.totalFloat > 0 && t.totalFloat <= 5).length
    if (near >= 10) alerts.push({ code: 'near_critical', severity: 'info', text: `${near} activities have 5 or fewer days of float.` })
    const review = reviewStatusOf(g, p.reviews)
    if (review === 'changes_requested') alerts.push({ code: 'review_rejected', severity: 'warning', text: 'The last expert review requested changes.' })
    else if (review === 'stale') alerts.push({ code: 'review_stale', severity: 'warning', text: 'The schedule changed after its last expert review.' })
    else if (review === 'none') alerts.push({ code: 'review_none', severity: 'info', text: 'No expert review recorded yet.' })
    if (!p.scheduleId) alerts.push({ code: 'unpublished', severity: 'info', text: 'Not published as a baseline yet.' })
  }
  if (elic.dateIssues?.length) alerts.push({ code: 'date_conflict', severity: 'warning', text: `${elic.dateIssues.length} date conflict${elic.dateIssues.length > 1 ? 's' : ''} in the interview answers.` })
  if (elic.readiness < 60 && g) alerts.push({ code: 'low_readiness', severity: 'warning', text: `Only ${elic.readiness}% of the interview is answered; much of the schedule rests on assumptions.` })
  // updatedAt comes from Postgres as a timestamp string in whatever format the driver produced.
  const updated = new Date(p.updatedAt)
  const idle = isNaN(updated.getTime()) ? 0 : days(updated.toISOString(), today)
  if (idle > STALE_PLAN_DAYS) alerts.push({ code: 'stale', severity: 'warning', text: `Not updated for ${idle} days.` })
  return {
    kind: 'plan', id: p.id, name: p.name, href: `/dashboard/plan/${p.id}`, finish, required, gapDays, readiness: elic.readiness,
    updatedAt: isNaN(updated.getTime()) ? p.updatedAt : updated.toISOString(), status: statusOf(alerts, !!g), alerts,
  }
}

/**
 * One uploaded schedule. Status, variance and their reasons come from Planora's stored analysis
 * (src/lib/analysis/schedule-analysis.ts) — the same numbers the dashboard overview shows — never
 * from a separate computation here. Uploads without a stored analysis show no status until opened.
 */
export function scheduleRow(s: Schedule, today: string, updates = 1): PortfolioRow {
  const alerts: PortfolioAlert[] = []
  const an = s.analysis ?? null
  const v = an ? an.varianceDays : null
  if (an) {
    for (const reason of an.statusReasons ?? []) alerts.push(reasonAlert(reason, an.varianceDays))
  } else {
    alerts.push({ code: 'not_analyzed', severity: 'info', text: 'Planora has not analyzed this upload yet; open it to calculate status and variance.' })
  }
  if (s.dataDate) {
    const age = days(s.dataDate, today)
    if (age > STALE_DATA_DATE_DAYS && s.percentComplete < 100 && an?.status !== 'complete') alerts.push({ code: 'stale_status', severity: 'warning', text: `Data date ${us(s.dataDate)} is ${age} days old; a status update is overdue.` })
  }
  if (s.warnings.length) alerts.push({ code: 'import_warnings', severity: 'info', text: `${s.warnings.length} import warning${s.warnings.length > 1 ? 's' : ''}.` })
  const finish = an?.forecastFinish ?? s.projectFinish
  // Exactly the analysis status (the overview badge); 'not_started' = not analyzed yet.
  const status: PortfolioRow['status'] = an ? an.status : 'not_started'
  return {
    kind: 'schedule', id: s.id, name: `${s.name} (${s.version})`, href: `/dashboard?schedule=${s.id}`, finish, required: an?.mustFinishBy ?? null,
    gapDays: v, readiness: null, updatedAt: isNaN(Date.parse(s.uploadedAt)) ? s.uploadedAt : new Date(s.uploadedAt).toISOString(), status, alerts,
    updates, dataDate: s.dataDate, varianceBasis: an ? fmtDates([an.baseline?.header ? `${an.baseline.header}.` : '', an.varianceBasis].filter(Boolean).join(' ')) || null : null,
  }
}

/** One analysis status reason as an alert, with the severity the analysis gave it. */
function reasonAlert(reason: string, varianceDays: number | null): PortfolioAlert {
  const text = fmtDates(reason)
  if (/negative float/i.test(reason)) return { code: 'negative_float', severity: 'error', text }
  if (/constraint/i.test(reason)) return { code: 'constraint_overrules_logic', severity: 'error', text }
  if (/behind baseline/i.test(reason)) return { code: 'behind', severity: varianceDays != null && varianceDays > 14 ? 'error' : 'warning', text }
  if (/required finish/i.test(reason)) return { code: 'late', severity: 'error', text }
  if (/already passed/i.test(reason)) return { code: 'finish_passed', severity: 'error', text }
  return { code: 'analysis', severity: 'warning', text }
}

/** Latest update first: by data date, then upload time. */
const newer = (a: Schedule, b: Schedule) =>
  (b.dataDate || '').localeCompare(a.dataDate || '') || (Date.parse(b.uploadedAt) || 0) - (Date.parse(a.uploadedAt) || 0)

/**
 * Uploads of one project (same project_key) form an update series; the portfolio shows only the
 * latest update of each, with the count. Uploads without a project key stay separate.
 */
export function latestUpdates(schedules: Schedule[]): { schedule: Schedule; updates: number }[] {
  const series = new Map<string, Schedule[]>()
  const out: { schedule: Schedule; updates: number }[] = []
  for (const s of schedules) {
    if (s.sourceType === 'generated') continue
    if (!s.projectKey) { out.push({ schedule: s, updates: 1 }); continue }
    const list = series.get(s.projectKey) ?? []
    list.push(s)
    series.set(s.projectKey, list)
  }
  for (const list of series.values()) out.push({ schedule: [...list].sort(newer)[0], updates: list.length })
  return out
}

const RANK: Record<PortfolioRow['status'], number> = { at_risk: 0, attention: 1, on_track: 2, not_started: 3, complete: 4 }

export function buildPortfolio(plans: Plan[], schedules: Schedule[], today = new Date().toISOString().slice(0, 10)): Portfolio {
  // A published plan's generated schedule is represented by the plan row.
  const rows = [
    ...plans.map(p => planRow(p, today)),
    ...latestUpdates(schedules).map(({ schedule, updates }) => scheduleRow(schedule, today, updates)),
  ].sort((a, b) => RANK[a.status] - RANK[b.status] || b.alerts.length - a.alerts.length || b.updatedAt.localeCompare(a.updatedAt))
  return {
    rows,
    totals: {
      projects: rows.length,
      atRisk: rows.filter(r => r.status === 'at_risk').length,
      attention: rows.filter(r => r.status === 'attention').length,
      onTrack: rows.filter(r => r.status === 'on_track').length,
      alerts: rows.reduce((n, r) => n + r.alerts.filter(a => a.severity !== 'info').length, 0),
    },
  }
}
