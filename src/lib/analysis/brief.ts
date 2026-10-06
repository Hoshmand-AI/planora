// "What is this project?" in a few lines, computed from the schedule itself (no model needed):
// what and where, key dates, scope by WBS, progress, and the next milestones that must be achieved.

import type { Activity, Schedule } from '@/lib/db'
import { PROJECT_TYPE_LABELS, type ProjectType, type CanonicalCategory } from '@/lib/planning/types'
import { phaseOf } from '@/lib/semantic/taxonomy'
import { PHASE_LABELS } from '@/lib/export/wbs'
import { fmtDate } from '@/lib/format'

export interface ProjectBrief {
  headline: string
  facts: { label: string; value: string }[]
  scope: string[]
  nextMilestones: { name: string; date: string; critical: boolean }[]
  finishMilestone: { name: string; date: string } | null
  summary: string
  /** Plain-text block for model prompts */
  text: string
}


function monthsBetween(a: string, b: string) {
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / (30.44 * 86_400_000)))
}

export function projectBrief(s: Schedule, activities: Activity[], extra: { city?: string | null; state?: string | null; sqft?: number | null; type?: string | null } = {}): ProjectBrief {
  // Only a type the user set (upload or interview) is shown; guessing from names mislabeled bridges as
  // retail and barracks as hospitals in client-facing text.
  const typeKey = (extra.type || s.projectType || null) as ProjectType | null
  const typeLabel = typeKey && PROJECT_TYPE_LABELS[typeKey] ? PROJECT_TYPE_LABELS[typeKey] : null
  const where = [extra.city, extra.state || s.region].filter(Boolean).join(', ') || null
  const sqft = extra.sqft ?? s.grossSqft
  const start = s.projectStart, finish = s.projectFinish
  const dataDate = s.dataDate
  const work = activities.filter(a => a.activityType !== 'summary' && a.activityType !== 'loe')
  const done = work.filter(a => a.status === 'complete').length
  const pct = work.length ? Math.round((100 * done) / work.length) : 0

  // Scope by work phase (from semantic normalization, so it works for every file format), in schedule order.
  const groups = new Map<string, { n: number; first: string }>()
  for (const a of work) {
    const cat = (a.category || 'other') as CanonicalCategory
    if (cat === 'other') continue
    const key = PHASE_LABELS[phaseOf(cat)] || phaseOf(cat)
    const g = groups.get(key)
    const when = a.earlyStart || a.actualStart || '9999'
    if (g) { g.n++; if (when < g.first) g.first = when } else groups.set(key, { n: 1, first: when })
  }
  const scope = [...groups.entries()].sort((x, y) => x[1].first.localeCompare(y[1].first)).map(([k, v]) => `${k} (${v.n})`)

  const ms = work.filter(a => a.activityType === 'milestone')
  const upcoming = ms.filter(a => a.status !== 'complete' && (a.earlyFinish || a.earlyStart))
    .sort((a, b) => (a.earlyFinish || a.earlyStart || '').localeCompare(b.earlyFinish || b.earlyStart || ''))
  const finishMs = [...ms].filter(a => /substantial|final|complet|turnover|handover|occupan|\bco\b|c of o/i.test(a.name))
    .sort((a, b) => (b.earlyFinish || '').localeCompare(a.earlyFinish || ''))[0] || upcoming[upcoming.length - 1] || null
  const nextMilestones = upcoming.slice(0, 5).map(a => ({ name: a.name, date: fmtDate(a.earlyFinish || a.earlyStart), critical: a.isCritical }))

  const headline = `${s.name}${typeLabel ? ` — ${typeLabel.toLowerCase()}` : ''}${where ? ` in ${where}` : ''}`
  const facts = [
    typeLabel && { label: 'Type', value: typeLabel },
    where && { label: 'Location', value: where },
    sqft && { label: 'Size', value: `${Math.round(sqft).toLocaleString()} sf` },
    start && { label: 'Start', value: fmtDate(start) },
    finish && { label: 'Forecast finish', value: fmtDate(finish) },
    start && finish && { label: 'Duration', value: `${monthsBetween(start, finish)} months` },
    dataDate && { label: 'Data date', value: fmtDate(dataDate) },
    { label: 'Progress', value: `${pct}% of ${work.length} activities complete` },
  ].filter(Boolean) as { label: string; value: string }[]

  const sentences = [
    `${s.name} is ${typeLabel ? `a ${typeLabel.toLowerCase()} project` : 'a construction project'}${where ? ` in ${where}` : ''}${sqft ? ` of about ${Math.round(sqft).toLocaleString()} sf` : ''}${start && finish ? `, scheduled from ${fmtDate(start)} to ${fmtDate(finish)} (${monthsBetween(start, finish)} months)` : ''}.`,
    scope.length ? `The work runs through ${scope.map(x => x.replace(/ \(\d+\)$/, '').toLowerCase()).join(', ')}.` : '',
    finishMs ? `The goal is ${finishMs.name.toLowerCase().startsWith('substantial') ? '' : 'reaching '}${finishMs.name} by ${fmtDate(finishMs.earlyFinish || finishMs.earlyStart)}${nextMilestones[0] && nextMilestones[0].name !== finishMs.name ? `; the next milestone is ${nextMilestones[0].name} on ${nextMilestones[0].date}` : ''}.` : '',
    `${pct}% of activities are complete${dataDate ? ` as of ${fmtDate(dataDate)}` : ''}.`,
  ].filter(Boolean)
  const summary = sentences.join(' ')
  const text = [
    `PROJECT OVERVIEW: ${summary}`,
    ...facts.map(f => `- ${f.label}: ${f.value}`),
    scope.length ? `- Scope by phase (activity count): ${scope.join('; ')}` : '',
    nextMilestones.length ? `- Next milestones: ${nextMilestones.map(m => `${m.name} ${m.date}${m.critical ? ' (critical)' : ''}`).join('; ')}` : '',
  ].filter(Boolean).join('\n')
  return { headline, facts, scope, nextMilestones, finishMilestone: finishMs ? { name: finishMs.name, date: fmtDate(finishMs.earlyFinish || finishMs.earlyStart) } : null, summary, text }
}
