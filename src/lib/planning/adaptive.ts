// Adaptive interview: decide which question is worth asking next, and when to stop.
//
// A senior scheduler doesn't ask 60 questions in a fixed order. They ask what moves the finish
// date, skip what can't matter yet, and stop when the plan is good enough to build. This module
// does that with the real scheduling engine instead of guesses:
//
//  1. Gating. A question is held back while the answer it depends on is missing. Permits and
//     long-lead items wait until we know the facility type and location; milestone targets wait
//     for the start date; review time waits for whether drawings exist. Nothing is asked "too early".
//  2. Value of information. For every open question we re-schedule the project under each plausible
//     answer (and under the current assumption) and measure how far the finish date swings. That
//     swing, in calendar days, is what the answer is worth.
//  3. Ordering. Foundations first (type, location, scope, size), then the biggest swing.
//  4. Stopping. When no open question can move the finish by more than a threshold, the brief is
//     "enough to build": the rest is offered as optional detail, not forced on the user.
//
// Pure and deterministic, so it is unit tested. One schedule generation takes a few milliseconds;
// probing is capped by a time budget and falls back to static impact for anything not probed.

import type { Answer, AnswerValue, ElicitationResult, Question } from './types'
import type { FirmHistory } from './history'
import { generateSchedule } from './generator'

export type QuestionRole = 'foundation' | 'driver' | 'group' | 'detail' | 'no_effect' | 'anchor' | 'cost' | 'unprobed'

export interface QuestionInsight {
  id: string
  role: QuestionRole
  /** Calendar days the finish moves across plausible answers (null when not measured) */
  swingDays: number | null
  /** Plain-language reason for its position */
  reason: string
}

/**
 * Items that run in parallel (long-lead equipment, permits, regulations) mask each other: changing
 * one alone moves nothing because another is just as long. Probed together, they can drive the
 * finish. Such a set is asked as one checklist instead of many separate questions.
 */
export interface QuestionGroup { id: string; label: string; questionIds: string[]; swingDays: number; reason: string }

export interface DeferredQuestion { id: string; prompt: string; waitingFor: string[]; reason: string }

export interface AdaptiveInterview {
  /** Open questions to ask now, best first */
  ask: Question[]
  /** Open questions that can't change the finish (or only marginally): offered, never pushed */
  optional: Question[]
  /** Held back until a prerequisite is answered */
  deferred: DeferredQuestion[]
  /** Parallel items that only matter together; their members appear in `ask` next to each other */
  groups: QuestionGroup[]
  insights: Record<string, QuestionInsight>
  /** Questions in `ask` that can still move the finish by at least `thresholdDays` */
  remainingThatMatter: number
  thresholdDays: number
  /** Combined uncertainty in the finish date from what is still open (± calendar days) */
  finishUncertaintyDays: number
  /** Forecast finish under current answers and assumptions */
  baselineFinish: string | null
  /** True when the open questions can no longer move the finish materially */
  enoughToBuild: boolean
  /** How many schedules were simulated to decide this */
  simulations: number
}

/** Answered first, in this order: everything else depends on them. */
export const FOUNDATIONS = ['project.type', 'project.state', 'project.scope', 'project.gross_sqft', 'project.target_start']

/** Prerequisites a question waits for (answered with any status counts, except where noted). */
export function prerequisitesOf(q: Question): string[] {
  if (q.section === 'permits' || q.section === 'regulatory') return ['project.type', 'project.state']
  if (q.section === 'procurement') return ['project.type']
  if (q.section === 'milestones') return ['project.target_start']
  if (q.section === 'cost') return ['project.required_finish']
  if (q.id === 'design.review_weeks' || q.id === 'design.percent') return ['design.drawings']
  if (q.id === 'project.stories' || q.id === 'site.acres_disturbed') return ['project.scope']
  if (q.id === 'calendar.weather') return ['project.state']
  return []
}

const PRETTY: Record<string, string> = {
  'project.type': 'the facility type', 'project.state': 'the location', 'project.scope': 'the scope of work', 'project.target_start': 'the start date',
  'project.required_finish': 'the required completion date', 'design.drawings': 'whether drawings exist', 'project.gross_sqft': 'the building size',
}

/** Plausible answers to try for a question, or null when it can't be probed meaningfully. */
export function probeValues(q: Question): AnswerValue[] | null {
  if (q.kind === 'boolean') return [true, false]
  if (q.kind === 'choice') return q.options && q.options.length <= 8 ? q.options.map(o => o.value) : null
  if (q.kind === 'number') {
    switch (q.unit) {
      case 'sf': return [20_000, 80_000, 250_000]
      case 'stories': return [1, 3, 8]
      case '%': return [0, 50, 100]
      case 'weeks': return [2, 6, 12]
      case 'acres': return [0.5, 3, 15]
      case 'work days': return [0, 10, 40]
      case 'constraints': return [0, 2, 6]
      default: return null
    }
  }
  return null
}

const DAY = 86_400_000
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

export interface AdaptiveOptions {
  history?: FirmHistory | null
  today?: string
  /** Stop probing after this many milliseconds (remaining questions use static impact) */
  budgetMs?: number
  /** A question that can move the finish less than this is optional detail */
  thresholdDays?: number
}

export function adaptiveInterview(answers: Record<string, Answer>, el: ElicitationResult, opts: AdaptiveOptions = {}): AdaptiveInterview {
  const today = opts.today || new Date().toISOString().slice(0, 10)
  const budget = opts.budgetMs ?? 900
  const started = Date.now()
  const insights: Record<string, QuestionInsight> = {}
  const deferred: DeferredQuestion[] = []
  const ready: Question[] = []
  let simulations = 0

  for (const q of el.questions) {
    const waiting = prerequisitesOf(q).filter(p => !answers[p])
    if (waiting.length) {
      deferred.push({ id: q.id, prompt: q.prompt, waitingFor: waiting, reason: `Asked after ${waiting.map(w => PRETTY[w] || w).join(' and ')}, because the answer depends on it.` })
    } else ready.push(q)
  }

  const finishFor = (a: Record<string, Answer>): string | null => {
    simulations++
    try { return generateSchedule({ answers: a, history: opts.history ?? null, today }).cpm?.projectFinish ?? null } catch { return null }
  }
  const baselineFinish = answers['project.type']?.status === 'known' ? finishFor(answers) : null
  const span = baselineFinish ? Math.max(30, days(today, baselineFinish)) : 365
  // "Matters" = can move the finish by at least 1% of the remaining duration, and never less than 5 days.
  const thresholdDays = opts.thresholdDays ?? Math.max(5, Math.round(span * 0.01))

  const extremes = new Map<string, { best: AnswerValue; worst: AnswerValue }>()
  // Probe in order of static impact so the budget is spent where it most likely matters.
  for (const q of [...ready].sort((a, b) => b.impact - a.impact)) {
    if (FOUNDATIONS.includes(q.id)) {
      insights[q.id] = { id: q.id, role: 'foundation', swingDays: null, reason: 'Everything else depends on this, so it comes first.' }
      continue
    }
    if (q.section === 'cost') { insights[q.id] = { id: q.id, role: 'cost', swingDays: 0, reason: 'Prices the recovery options; it does not change the schedule.' }; continue }
    if (q.section === 'milestones' || q.id === 'project.required_finish') {
      insights[q.id] = { id: q.id, role: 'anchor', swingDays: null, reason: q.id === 'project.required_finish' ? 'Sets the date the plan is measured against, so float and recovery options are real.' : 'A target to check the plan against; it does not move the forecast.' }
      continue
    }
    const values = probeValues(q)
    if (!values || !baselineFinish || Date.now() - started > budget) {
      insights[q.id] = { id: q.id, role: 'unprobed', swingDays: null, reason: 'Ranked by its typical effect on the schedule.' }
      continue
    }
    const finishes: string[] = [baselineFinish]
    let best: { v: AnswerValue; f: string } | null = null, worst: { v: AnswerValue; f: string } | null = null
    for (const v of values) {
      const f = finishFor({ ...answers, [q.id]: { status: 'known', value: v, answeredAt: today, source: 'user' } })
      if (!f) continue
      finishes.push(f)
      if (!best || f < best.f) best = { v, f }
      if (!worst || f > worst.f) worst = { v, f }
    }
    if (best && worst) extremes.set(q.id, { best: best.v, worst: worst.v })
    const sorted = finishes.sort()
    const swing = days(sorted[0], sorted[sorted.length - 1])
    insights[q.id] = swing >= thresholdDays
      ? { id: q.id, role: 'driver', swingDays: swing, reason: `Depending on the answer, the finish moves by up to ${swing} days.` }
      : swing > 0
        ? { id: q.id, role: 'detail', swingDays: swing, reason: `Moves the finish by at most ${swing} day${swing === 1 ? '' : 's'}; worth answering when you have it.` }
        : { id: q.id, role: 'no_effect', swingDays: 0, reason: 'None of the possible answers changes the finish date; it refines the basis of schedule.' }
  }

  // Group probing: parallel items each "do nothing" alone; set them all to their best and worst case.
  const known = (v: AnswerValue): Answer => ({ status: 'known', value: v, answeredAt: today, source: 'user' })
  const groups: QuestionGroup[] = []
  const GROUPS: { id: string; label: string; match: (q: Question) => boolean }[] = [
    { id: 'procurement', label: 'Long-lead equipment and materials', match: q => q.section === 'procurement' && q.id.endsWith('.status') },
    { id: 'permits', label: 'Permits and approvals', match: q => q.section === 'permits' && q.id.endsWith('.status') },
    { id: 'regulatory', label: 'Regulations that may apply', match: q => q.section === 'regulatory' },
  ]
  for (const gdef of GROUPS) {
    const members = ready.filter(q => gdef.match(q) && extremes.has(q.id) && (insights[q.id]?.swingDays ?? 0) < thresholdDays)
    if (members.length < 2 || !baselineFinish || Date.now() - started > budget * 1.5) continue
    const bestCase = { ...answers }, worstCase = { ...answers }
    for (const q of members) { bestCase[q.id] = known(extremes.get(q.id)!.best); worstCase[q.id] = known(extremes.get(q.id)!.worst) }
    const fs = [baselineFinish, finishFor(bestCase), finishFor(worstCase)].filter((x): x is string => !!x).sort()
    const swing = days(fs[0], fs[fs.length - 1])
    if (swing < thresholdDays) continue
    const reason = `Together these move the finish by up to ${swing} days. Any one alone changes little because the others run in parallel, so they're asked as one checklist.`
    groups.push({ id: gdef.id, label: gdef.label, questionIds: members.map(q => q.id), swingDays: swing, reason })
    for (const q of members) insights[q.id] = { id: q.id, role: 'group', swingDays: insights[q.id]?.swingDays ?? 0, reason }
  }
  const groupSwing = new Map(groups.flatMap(g => g.questionIds.map(id => [id, g.swingDays] as const)))

  const rank = (q: Question): number => {
    const i = insights[q.id]
    if (!i) return 0
    if (i.role === 'foundation') return 1e9 - FOUNDATIONS.indexOf(q.id)
    if (i.role === 'anchor') return q.id === 'project.required_finish' ? 1e6 : 1e3 + q.impact
    if (i.role === 'driver') return 1e5 + (i.swingDays ?? 0)
    if (i.role === 'group') return 1e5 + (groupSwing.get(q.id) ?? 0) - 0.001 * (1000 - q.impact)
    if (i.role === 'unprobed') return 1e4 + q.impact
    return q.impact
  }
  const ordered = [...ready].sort((a, b) => rank(b) - rank(a) || b.impact - a.impact)
  const isOptional = (q: Question) => ['detail', 'no_effect', 'cost'].includes(insights[q.id]?.role ?? '') || q.section === 'milestones' || q.section === 'history'
  const ask = ordered.filter(q => !isOptional(q))
  const optional = ordered.filter(isOptional)
  const swings = [...Object.values(insights).filter(i => i.role !== 'group').map(i => i.swingDays ?? 0), ...groups.map(g => g.swingDays)].filter(s => s > 0)
  const finishUncertaintyDays = Math.round(Math.sqrt(swings.reduce((s, x) => s + x * x, 0)) / 2)
  // A group counts once: it is one checklist for the user.
  const remainingThatMatter = ask.filter(q => ['foundation', 'driver', 'unprobed'].includes(insights[q.id]?.role ?? '')).length + groups.length
  const foundationsDone = FOUNDATIONS.every(f => answers[f])

  return {
    ask, optional, deferred, groups, insights, remainingThatMatter, thresholdDays, finishUncertaintyDays, baselineFinish,
    enoughToBuild: foundationsDone && !ask.some(q => ['foundation', 'driver', 'group'].includes(insights[q.id]?.role ?? '')),
    simulations,
  }
}
