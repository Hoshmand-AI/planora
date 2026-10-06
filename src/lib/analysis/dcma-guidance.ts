// Turn a DCMA result into guidance a scheduler can act on: what the check means, why it matters,
// which activities fail it, how to fix it, and the decision options (fix vs. accept with justification).

import type { DcmaCheck } from '@/lib/planning/types'

export type GuidanceAction =
  | { kind: 'recovery'; label: string }
  | { kind: 'interview'; label: string }
  | { kind: 'filter'; label: string; codes: string[] }
  | { kind: 'accept'; label: string; suggestedNote: string }
  /** Go to another page (e.g. an uploaded schedule's what-if and recovery options on the dashboard) */
  | { kind: 'link'; label: string; href: string }

export interface CheckGuidance {
  id: number
  meaning: string
  whyItMatters: string
  steps: string[]
  actions: GuidanceAction[]
}

interface Ctx {
  /** Plan built in Planora (edits possible) vs an uploaded file (fix in P6/MSP) */
  generated: boolean
  /** Share of offenders that are design, permit review or fabrication activities */
  offCalendarShare?: number
  hasRecovery?: boolean
  hasOpenQuestions?: boolean
  hasTargets?: boolean
  /** Uploaded schedules: where its what-if / recovery options and Planora edits live (dashboard) */
  uploadedRecoveryHref?: string
}

export function guidanceFor(c: DcmaCheck, ctx: Ctx): CheckGuidance {
  const where = ctx.generated ? 'on the Schedule tab (open the activity → Override)'
    : ctx.uploadedRecoveryHref ? 'in P6 / MS Project and re-upload, or as a Planora edit with a reason (schedule dashboard → Edits made in Planora)' : 'in P6 / MS Project, then re-upload'
  // Recovery for a plan is on its Schedule tab; for an upload, on the schedule dashboard (modeled on its own network).
  const recoverySteps = ctx.generated
    ? ['Decide how to recover the time: shorten or re-sequence the critical path, or move the date.', 'Use the recovery options — each is modeled on the real network with its new finish.']
    : ['Decide how to recover the time: shorten or re-sequence the driving path, or move the date.',
      ctx.uploadedRecoveryHref
        ? 'Open What-if and recovery on the schedule dashboard: crashing, overlapping and expediting options are modeled on this file\'s own network with the new finish and float. Apply one as a Planora edit with a reason, or make the change in P6 / MS Project and re-upload.'
        : 'Make the change in P6 / MS Project (shorten or re-sequence driving activities), then re-upload.']
  const recoveryActions: GuidanceAction[] = ctx.generated
    ? (ctx.hasRecovery ? [{ kind: 'recovery', label: 'See recovery options' }] : [])
    : ctx.uploadedRecoveryHref ? [{ kind: 'link', label: 'Open what-if and recovery options', href: ctx.uploadedRecoveryHref }] : []
  // Thresholds come from the check itself, so organization-specific limits read correctly.
  const pct = /(\d+(?:\.\d+)?)%/.exec(c.threshold)?.[1] ?? '5'
  const days = /> (\d+)d/.exec(c.threshold)?.[1] ?? '44'
  const filter: GuidanceAction[] = c.offenders.length ? [{ kind: 'filter', label: `Show the ${c.offenders.length} activities`, codes: c.offenders }] : []
  switch (c.id) {
    case 1: return {
      id: 1, meaning: 'Activities without a predecessor or a successor ("open ends").',
      whyItMatters: 'An open-ended activity can slip without moving anything else, so the critical path and float are unreliable.',
      steps: ['Give every activity a predecessor (except the start milestone) and a successor (except the finish milestone).', `Add the missing relationships ${where}.`],
      actions: [...filter],
    }
    case 2: return {
      id: 2, meaning: 'Relationships with negative lag ("leads").',
      whyItMatters: 'Leads let a successor start before its predecessor finishes in a way that is hard to status and can hide delay.',
      steps: ['Replace each lead with a start-to-start relationship plus a positive lag, or split the predecessor so the overlap is explicit.', `Change the logic ${where}.`],
      actions: [...filter],
    }
    case 3: return {
      id: 3, meaning: `More than ${pct}% of relationships carry a lag.`,
      whyItMatters: 'Lags are invisible time: they can\'t be statused or assigned to anyone.',
      steps: ['Replace long lags (cure time, review periods) with real activities.', 'Keep short lags only where they reflect a physical wait.', `Edit the relationships ${where}.`],
      actions: [...filter],
    }
    case 4: return {
      id: 4, meaning: 'Fewer than 90% of relationships are finish-to-start.',
      whyItMatters: 'Heavy use of SS/FF logic makes the path hard to follow and can hide the true driver.',
      steps: ['Convert SS/FF pairs to finish-to-start by splitting activities into smaller pieces (e.g. by floor or area).', `Change the logic ${where}.`],
      actions: [...filter],
    }
    case 5: return {
      id: 5, meaning: `Hard date constraints (mandatory, start-no-later / finish-no-later) on more than ${pct}% of activities.`,
      whyItMatters: 'Hard constraints override logic, so the schedule can show dates the work can\'t actually achieve.',
      steps: ['Keep constraints only for true contractual dates.', ctx.hasTargets ? 'Milestone targets from the interview are held as finish-no-later-than; remove targets you don\'t need contractually.' : 'Replace others with logic.'],
      actions: [...filter, ...(ctx.hasTargets ? [{ kind: 'interview' as const, label: 'Review milestone targets' }] : [])],
    }
    case 6: {
      const mostlyOff = (ctx.offCalendarShare ?? 0) >= 0.5
      return {
        id: 6, meaning: `More than ${pct}% of activities have over ${days} working days of total float.`,
        whyItMatters: 'Very high float usually means a missing successor: the activity could slip for months without showing an impact.',
        steps: [
          'Check each flagged activity\'s successors — does it really have nothing waiting on it?',
          mostlyOff ? 'Most flagged items are permit reviews or fabrication that finish well before installation. That float is real (the item is simply early) — accept it with a justification, or release the purchase later.' : 'Add the missing successor logic so the activity drives something.',
        ],
        actions: [...filter, ...(ctx.generated && mostlyOff ? [{ kind: 'accept' as const, label: 'Accept as justified', suggestedNote: 'Float on permit reviews and long-lead fabrication is real: items are released early and linked to their installation activities.' }] : [])],
      }
    }
    case 7: return {
      id: 7, meaning: 'Activities with negative float.',
      whyItMatters: 'Negative float means the plan cannot meet a date it has been given (required completion or a milestone target).',
      steps: recoverySteps,
      actions: recoveryActions.length ? [...recoveryActions, ...(ctx.generated ? [] : filter)] : [...filter, ...(ctx.hasTargets ? [{ kind: 'interview' as const, label: 'Review milestone targets' }] : [])],
    }
    case 8: {
      const mostlyOff = (ctx.offCalendarShare ?? 0) >= 0.5
      return {
        id: 8, meaning: `More than ${pct}% of activities last longer than ${days} working days.`,
        whyItMatters: 'Long activities are hard to status: progress is a guess until they finish.',
        steps: [
          mostlyOff ? 'Flagged items are mostly design phases, agency reviews and fabrication. Their length is set by others and is normal — accept with a justification, or break design into submission packages.' : `Split long field activities by floor or area so each piece is ${days} days or less.`,
          `Edit durations ${where}.`,
        ],
        actions: [...filter, ...(ctx.generated && mostlyOff ? [{ kind: 'accept' as const, label: 'Accept as justified', suggestedNote: `Long durations are design phases, agency reviews and supplier fabrication, which are controlled by others; field work is detailed to ${days} days or less.` }] : [])],
      }
    }
    case 9: return {
      id: 9, meaning: 'Dates that are impossible relative to the data date: actuals in the future or forecasts in the past.',
      whyItMatters: 'Invalid dates mean the schedule wasn\'t statused or recalculated correctly, so every forecast after them is suspect.',
      steps: ['Move unfinished work to start on or after the data date and recalculate.', 'Actual dates must be on or before the data date.', ctx.generated ? 'For a plan built in Planora, regenerate after checking the start date is a working day.' : 'Fix in P6 (F9 schedule) or MS Project, then re-upload.'],
      actions: [...filter],
    }
    case 10: return {
      id: 10, meaning: 'Activities with duration but no resources.', whyItMatters: 'Without resources the schedule can\'t be checked for over-allocation or cost-loaded.',
      steps: ['Assign crews or cost to work activities if the contract requires a resource-loaded schedule.'], actions: [...filter],
    }
    case 11: return {
      id: 11, meaning: 'Activities that should have finished before the data date (per the baseline) but didn\'t.',
      whyItMatters: 'Missed tasks are the earliest sign of slippage.', steps: ['Review each missed task and its impact on the critical path; re-plan the remaining work.'], actions: [...filter],
    }
    case 12: return {
      id: 12, meaning: 'Adding a large delay to a critical activity did not move the finish by the same amount.',
      whyItMatters: 'The critical path is broken — usually by a constraint or lag that absorbs delay.',
      steps: ['Look for constraints and long lags on the critical path and replace them with logic.'], actions: [...filter],
    }
    case 13: return {
      id: 13, meaning: 'Critical Path Length Index below 0.95: the remaining time is not enough for the remaining critical work.',
      whyItMatters: 'A CPLI below 1.0 means the finish date is at risk without recovery.',
      steps: ctx.generated ? ['Recover time on the critical path or agree a new date — see the recovery options.'] : [recoverySteps[1], 'Or agree a new date with the owner.'],
      actions: recoveryActions,
    }
    case 14: return {
      id: 14, meaning: 'Baseline Execution Index below 0.95: fewer activities finished than the baseline planned by now.',
      whyItMatters: 'The team is completing work more slowly than planned.', steps: ['Compare the missed activities with the baseline and plan catch-up for the critical ones.'], actions: [...filter],
    }
    default: return { id: c.id, meaning: c.explanation, whyItMatters: '', steps: [], actions: [...filter] }
  }
}
