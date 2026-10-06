// Which activity is the contract completion? Shared by the headline analysis (variance, status,
// required-finish check) and DCMA #13 (CPLI), so both measure the same milestone. Pure.
//
// Order of preference:
//   1. the milestone the scheduler designated (activity id or activity code)
//   2. a completion-named milestone (Substantial / Project / Contract Completion; Final Completion,
//      turnover, occupancy...), even when it has successors (SC -> punch list -> Final Completion),
//      preferring one that carries a finish constraint, then Substantial over Final
//   3. other activities with no successors: milestones (P6 finish milestones over start milestones),
//      finish-constrained first
// Interim milestones (dry-in, topping out, enclosure, mobilization, NTP...) are never preferred over a
// completion milestone, whatever constraint they carry. Ties go to the latest forecast.

export interface FinishCandidate {
  id: string
  code: string
  name: string
  isMilestone: boolean
  /** P6 milestone type: TT_FinMile -> 'finish', TT_Mile -> 'start'; null when the source has no such type */
  milestoneKind?: 'start' | 'finish' | null
  constraintType?: string | null
  hasSuccessor: boolean
  /** Forecast (or actual) finish, ISO */
  finish: string | null
}

export const FINISH_CONSTRAINTS = new Set(['MFO', 'FO', 'FNLT'])
/** Contract completion: the date the contract usually measures (and liquidated damages run from) */
const SUBSTANTIAL = /substantial(ly)?\s+complet|project\s+complet|contract\s+complet|contract\s+finish|project\s+finish/i
/** Other completion milestones: valid finish milestones but second to substantial completion */
const COMPLETION = /final\s+(complet|accept)|turn\s*over|hand\s*over|occupan|\bc\s*of\s*o\b|certificate\s+of\s+(substantial\s+)?(complet|occupan)|close\s*out|project\s+end|\bcompletion\b/i
/** Interim (non-contract-completion) milestones */
const INTERIM = /dry[\s-]*in|dried[\s-]*in|top(ping|ped)?[\s-]*out|enclos|weather[\s-]*tight|water[\s-]*tight|mobiliz|mobilis|\bntp\b|notice\s+to\s+proceed|\bstart\b|\bbegin|\baward|foundations?\s+complet|structure\s+complet|steel\s+complet|roof(ing)?\s+complet|permanent\s+power|energiz|rough[\s-]*in|slab\s+complet|\bpermit/i

const normalizeConstraint = (t: string | null | undefined) => {
  const u = (t || '').toUpperCase().replace(/^CS_/, '')
  if (u === 'MANDFIN' || u === 'MANDFINISH') return 'MFO'
  if (u === 'MEO') return 'FO'
  if (u === 'MEOB') return 'FNLT'
  return u
}

export function isInterimName(name: string): boolean {
  return INTERIM.test(name) && !SUBSTANTIAL.test(name)
}

/** Score used to rank candidates (exported for tests). Null = not eligible. */
export function finishScore(c: FinishCandidate): number | null {
  const interim = isInterimName(c.name)
  const substantial = !interim && SUBSTANTIAL.test(c.name)
  const completion = !interim && (substantial || COMPLETION.test(c.name))
  // An activity with successors only qualifies as the finish when its name says it is a completion.
  if (c.hasSuccessor && !completion) return null
  const constrained = FINISH_CONSTRAINTS.has(normalizeConstraint(c.constraintType))
  return (interim ? -100 : 0)
    + (completion ? 40 : 0)
    + (constrained ? 20 : 0)
    + (substantial ? 10 : 0)
    + (c.isMilestone ? 8 : 0)
    + (c.milestoneKind === 'finish' ? 4 : c.milestoneKind === 'start' ? -8 : 0)
    + (c.hasSuccessor ? 0 : 2)
}

export function pickFinishCandidate<T extends FinishCandidate>(cands: T[], designated?: string | null): { pick: T; designated: boolean } | null {
  if (designated) {
    const d = designated.trim()
    const hit = cands.find(c => c.id === d) ?? cands.find(c => c.code === d) ?? cands.find(c => c.code.toLowerCase() === d.toLowerCase())
    if (hit) return { pick: hit, designated: true }
  }
  const scored = cands.map(c => ({ c, s: finishScore(c) })).filter((x): x is { c: T; s: number } => x.s !== null)
  if (!scored.length) return null
  scored.sort((x, y) => y.s - x.s || (y.c.finish || '').localeCompare(x.c.finish || ''))
  return { pick: scored[0].c, designated: false }
}
