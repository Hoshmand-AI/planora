// "The plan finishes after the required date — what now?"
// Explains the gap in plain terms and models concrete recovery options, each re-scheduled with the
// real network so the scheduler sees the new finish and the trade-off before deciding.

import type { Answer, GeneratedSchedule } from './types'
import { generateSchedule } from './generator'
import { applyEdit, type Edit } from './overrides'
import { questionBank, known } from './elicitation'
import type { FirmHistory } from './history'
import { countWorkDaysInclusive } from './calendar'

export type RecoveryApply =
  | { type: 'answers'; answers: Record<string, Partial<Answer>> }
  | { type: 'edits'; edits: Edit[] }
  | { type: 'navigate'; tab: 'interview' }

export interface RecoveryOption {
  id: string
  title: string
  description: string
  tradeoff: string
  newFinish: string
  daysSaved: number
  meetsDate: boolean
  apply: RecoveryApply
}

export interface RecoveryPlan {
  required: string
  finish: string
  gapDays: number
  gapWorkDays: number
  explanation: string[]
  drivers: { code: string; name: string; duration: number; kind: 'procurement' | 'permit' | 'design' | 'field' | 'contingency' }[]
  options: RecoveryOption[]
  combined: { ids: string[]; newFinish: string; meetsDate: boolean } | null
}

const d = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
const us = (x: string) => `${x.slice(5, 7)}/${x.slice(8, 10)}/${x.slice(0, 4)}`
const REASON = 'Recovery option chosen to meet the required completion date'

function kindOf(a: GeneratedSchedule['activities'][number]): RecoveryPlan['drivers'][number]['kind'] {
  if (a.category === 'contingency') return 'contingency'
  if (a.category === 'procurement' || a.category === 'submittals') return 'procurement'
  if (a.category.startsWith('permit')) return 'permit'
  if (a.phase === 'design') return 'design'
  return 'field'
}

export function recoveryPlan(g: GeneratedSchedule, answers: Record<string, Answer>, history: FirmHistory | null): RecoveryPlan | null {
  const required = g.mustFinishBy
  const finish = g.cpm?.projectFinish
  if (!required || !finish || finish <= required || !g.cpm) return null
  const t = g.cpm.times
  const byId = new Map(g.activities.map(a => [a.id, a]))
  const cp = g.cpm.criticalPath.map(id => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a && a.type === 'task')
  const drivers = [...cp].sort((a, b) => b.duration - a.duration).slice(0, 6).map(a => ({ code: a.code, name: a.name, duration: a.duration, kind: kindOf(a) }))
  const field = g.calendars.find(c => c.id === g.defaultCalendarId) || g.calendars[0]
  const gapDays = d(required, finish)
  const gapWorkDays = Math.max(1, countWorkDaysInclusive(required, finish, field) - 1)
  const regen = (patch: Record<string, Answer['value']>) => {
    const next = { ...answers }
    for (const [k, v] of Object.entries(patch)) next[k] = { status: 'known', value: v, answeredAt: new Date().toISOString(), source: 'user' }
    return generateSchedule({ answers: next, history, previous: g }).cpm!.projectFinish
  }
  const opt = (o: Omit<RecoveryOption, 'daysSaved' | 'meetsDate'>): RecoveryOption => ({ ...o, daysSaved: d(o.newFinish, finish), meetsDate: o.newFinish <= required })
  const options: RecoveryOption[] = []

  // 1. Longer work week.
  const ww = String(known(answers, 'calendar.workweek') || '5x8')
  if (ww !== '6x10' && ww !== '7x12') {
    options.push(opt({
      id: 'workweek', title: 'Work a 6-day week (Mon–Sat, 10-hour days)', newFinish: regen({ 'calendar.workweek': '6x10' }),
      description: 'More field hours per week shortens every construction activity. Reviews and fabrication are unchanged.',
      tradeoff: 'Overtime premium (typically 10–20% on labor), crew fatigue, and some jurisdictions restrict Saturday work.',
      apply: { type: 'answers', answers: { 'calendar.workweek': { status: 'known', value: '6x10' } } },
    }))
  }
  // 2. Early packages.
  const delivery = String(known(answers, 'project.delivery') || 'dbb')
  if (delivery === 'dbb') {
    options.push(opt({
      id: 'early_packages', title: 'Release early packages (CM at risk / design-build)', newFinish: regen({ 'project.delivery': 'cmar' }),
      description: 'Site permits and long-lead submittals start from design development instead of waiting for complete construction documents.',
      tradeoff: 'Requires a contract approach that allows early packages; some design risk moves to construction.',
      apply: { type: 'answers', answers: { 'project.delivery': { status: 'known', value: 'cmar' } } },
    }))
  }
  // 3. Expedite driving procurement / permits on the critical path.
  const bank = questionBank({ answers })
  const expediteEdits: Edit[] = []
  for (const a of cp) {
    if (a.category === 'procurement' && a.id.endsWith('-fab')) {
      const it = bank.longLead.find(l => a.id === `ll-${l.id}-fab`)
      if (it && it.leadWeeks.low * 7 < a.duration) expediteEdits.push({ kind: 'duration', activityId: a.id, value: it.leadWeeks.low * 7, reason: `${REASON}: expedite to the fastest market lead time (${it.leadWeeks.low} weeks)` })
    }
    if (a.category.startsWith('permit') && a.calendarId === 'cal-7d' && !a.id.endsWith('-submit')) {
      const pm = bank.permits.find(p => a.id === `permit-${p.id}`)
      if (pm && pm.reviewWeeks.low * 7 < a.duration) expediteEdits.push({ kind: 'duration', activityId: a.id, value: pm.reviewWeeks.low * 7, reason: `${REASON}: expedited review (pre-application meeting, phased or third-party review) at ${pm.reviewWeeks.low} weeks` })
    }
  }
  const runEdits = (edits: Edit[]) => edits.reduce((s, e) => applyEdit(s, e, 'Planora').schedule, g).cpm!.projectFinish
  if (expediteEdits.length) {
    options.push(opt({
      id: 'expedite', title: `Expedite ${expediteEdits.length} driving permit/procurement item${expediteEdits.length > 1 ? 's' : ''}`, newFinish: runEdits(expediteEdits),
      description: `Bring the critical ${expediteEdits.length > 1 ? 'items' : 'item'} to the fastest end of the market range: ${expediteEdits.map(e => byId.get((e as { activityId: string }).activityId)?.name).join('; ')}.`,
      tradeoff: 'Expedite fees, reserving factory slots early, or pre-application meetings with the agency. Confirm with suppliers/AHJ before relying on it.',
      apply: { type: 'edits', edits: expediteEdits },
    }))
  }
  // 4. Crash critical field work.
  const crashEdits: Edit[] = cp.filter(a => kindOf(a) === 'field' && a.duration >= 5)
    .map(a => ({ kind: 'duration' as const, activityId: a.id, value: Math.max(1, Math.round(a.duration * 0.85)), reason: `${REASON}: add crews to compress critical field work by 15%` }))
  if (crashEdits.length) {
    options.push(opt({
      id: 'crash', title: `Add crews to ${crashEdits.length} critical field activities (−15%)`, newFinish: runEdits(crashEdits),
      description: 'Shorten critical field activities by adding crews or shifts; only activities on the critical path are changed.',
      tradeoff: 'Higher labor cost, site congestion and supervision load; diminishing returns beyond ~15–20%.',
      apply: { type: 'edits', edits: crashEdits },
    }))
  }
  // 5. Contingency from open questions on the critical path.
  const cont = cp.find(a => a.id === 'contingency')
  if (cont) {
    const open = g.assumptions.filter(a => a.kind !== 'inferred' && a.bufferDays > 0).length
    options.push(opt({
      id: 'answer_questions', title: `Answer the open questions (${cont.duration} days of contingency are on the critical path)`,
      newFinish: runEdits([{ kind: 'duration', activityId: cont.id, value: 0, reason: 'what-if' }]),
      description: `${open} unanswered or unknown items carry a buffer. Answering them replaces guesses with facts and releases the contingency that isn't needed. The date shown assumes all of it is released.`,
      tradeoff: 'No cost — but only real answers release time; don\'t delete contingency without them.',
      apply: { type: 'navigate', tab: 'interview' },
    }))
  }
  // 6. Move the date.
  options.push({
    id: 'move_date', title: `Ask the owner to move the required date to ${us(finish)}`, newFinish: finish, daysSaved: 0, meetsDate: true,
    description: 'Accept the schedule the logic supports and negotiate the completion date (or interim milestones) now, while there is time to plan.',
    tradeoff: 'Commercial conversation; may involve liquidated damages or scope/phase trade-offs.',
    apply: { type: 'answers', answers: { 'project.required_finish': { status: 'known', value: finish } } },
  })

  // Combination: the modeled levers together (excluding moving the date and "answer questions").
  const levers = options.filter(o => ['workweek', 'early_packages', 'expedite', 'crash'].includes(o.id) && o.daysSaved > 0)
  let combined: RecoveryPlan['combined'] = null
  if (levers.length > 1) {
    const patch: Record<string, Answer['value']> = {}
    for (const o of levers) if (o.apply.type === 'answers') for (const [k, v] of Object.entries(o.apply.answers)) patch[k] = v.value as Answer['value']
    const next = { ...answers }
    for (const [k, v] of Object.entries(patch)) next[k] = { status: 'known', value: v, answeredAt: new Date().toISOString(), source: 'user' }
    let sch = Object.keys(patch).length ? generateSchedule({ answers: next, history, previous: g }) : g
    for (const o of levers) if (o.apply.type === 'edits') for (const e of o.apply.edits) { try { sch = applyEdit(sch, e, 'Planora').schedule } catch { /* activity may have changed */ } }
    combined = { ids: levers.map(o => o.id), newFinish: sch.cpm!.projectFinish, meetsDate: sch.cpm!.projectFinish <= required }
  }

  const negFloat = Math.min(...Object.values(t).map(x => x.totalFloat))
  const explanation = [
    `With the current logic, durations and lead times, the project finishes ${us(finish)} — ${gapDays} calendar days (about ${gapWorkDays} work days) after the required ${us(required)}.`,
    `That gap shows up as ${negFloat} days of total float on the critical path: every critical activity would have to finish that much earlier to make the date.`,
    `The biggest items on the critical path are ${drivers.slice(0, 3).map(x => `${x.code} ${x.name} (${x.duration}d, ${x.kind})`).join('; ')}. Time is only recovered by shortening or re-sequencing these — speeding up work with float changes nothing.`,
    options.some(o => o.meetsDate && o.id !== 'move_date')
      ? `Options below are modeled on the real network. At least one meets the date on its own.`
      : combined?.meetsDate
        ? `No single option closes the gap, but the modeled options together would (finish ${us(combined.newFinish)}).`
        : `The modeled options don't fully close the gap${combined ? ` (together: ${us(combined.newFinish)})` : ''}; combine them with a date conversation with the owner.`,
  ]
  return { required, finish, gapDays, gapWorkDays, explanation, drivers, options: options.sort((a, b) => (a.id === 'move_date' ? 1 : b.id === 'move_date' ? -1 : b.daysSaved - a.daysSaved)), combined }
}
