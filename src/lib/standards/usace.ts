// USACE UFGS 01 32 01.00 10 (Project Schedule) rule pack: checks drawn from the paragraphs of the
// U.S. Army Corps of Engineers guide specification that RunF9's schedule data can test.
//
// A guide specification is not a standard and not a contract: it binds a project only once it is
// edited into that project's contract, and the edited text governs. So every rule here has kind
// 'guide_specification', results are worded as checks "drawn from" the specification (never
// "compliant with"), and where the specification allows an exception RunF9 cannot see (an approval,
// a date named in the contract) the result is a warning with that stated, not a fail.
//
// Only paragraphs whose rule was read from the specification are covered. Titles, messages and
// recommendations are RunF9's own paraphrases; sourceReference is a citation only. The same
// population convention as the other packs applies: completed activities are not tested.

import { fmtDate } from '@/lib/format'
import { isValidDate } from '@/lib/planning/calendar'
import { normalizeConstraintType } from '@/lib/analysis/dcma'
import type { AnalyzableActivity } from '@/lib/planning/types'
import { plural, shareText, uniq, type Network } from './network'
import { notAssessable, threshold, type RuleDef } from './rule'
import { codes, danglingEnds, hasProgress, linkText, linksIntoOpen, openEnds, outOfSequence } from './shared'
import type { RuleMeta } from './types'

export const USACE_EDITION = 'August 2026'
export const USACE_VERSION = `UFGS 01 32 01.00 10 (${USACE_EDITION})`
export const USACE_DISCLAIMER = `These checks are drawn from the schedule rules in UFGS 01 32 01.00 10, Project Schedule (${USACE_EDITION} edition), the U.S. Army Corps of Engineers guide specification. A guide specification binds a project only when it is written into that project's contract, and the contract's own edited specification governs: its limits and exceptions can differ from the ones used here. Only paragraphs that schedule data can test are covered, and completed activities are not tested. This is an automated check of schedule data, not a determination of contract compliance. RunF9 is not affiliated with or endorsed by USACE.`

/** The duration limit for non-procurement activities, in work days (paragraph 3.3.2). */
export const USACE_MAX_DURATION_DAYS = 20

/**
 * How procurement activities are recognised. The schedule data RunF9 holds has no activity codes,
 * so the only signal is wording: an activity counts as procurement when its name or WBS path
 * contains one of these words. The finding states this every time.
 */
export const PROCUREMENT_WORDS = /\b(procure\w*|purchas\w*|fabricat\w*|deliver\w*|submittals?|submit|shop drawings?|lead[- ]?time|long[- ]lead|material orders?|buy[- ]?out)\b/i
const PROCUREMENT_WORDS_TEXT = 'procure, purchase, fabricate, deliver, submittal, submit, shop drawing, lead time, long lead, material order, buyout'
export const isProcurement = (a: AnalyzableActivity, net: Network) => PROCUREMENT_WORDS.test(a.name) || PROCUREMENT_WORDS.test(net.input.wbs?.[a.id] ?? '')

const MANDATORY = new Set(['MSO', 'MFO'])
/** Constraint settings that hold an activity at zero free or zero total float, as scheduling tools name them. */
const ZERO_FLOAT = /\b(ALAP|AS LATE AS POSSIBLE|ZERO (FREE|TOTAL) FLOAT|ZFF|ZTF)\b/i

type Meta = Pick<RuleMeta, 'ruleId' | 'severity' | 'calculation' | 'title' | 'message' | 'category'> & Partial<Pick<RuleMeta, 'applicability' | 'version'>> & { paragraph: string }
function usace({ paragraph, ...meta }: Meta, rest: Pick<RuleDef, 'evaluate'> & Partial<Pick<RuleDef, 'threshold' | 'parameters'>>): RuleDef {
  return {
    version: 1, kind: 'guide_specification', applicability: { subjects: ['schedule', 'plan'] }, ...meta,
    framework: 'USACE_UFGS', frameworkVersion: USACE_VERSION,
    sourceReference: `${USACE_VERSION}, paragraph ${paragraph}`,
    ...rest,
  }
}

const NO_OPEN = 'There are no open activities to test.'
const NO_LINKS = 'There are no relationships into open activities.'

export const USACE_RULES: RuleDef[] = [
  usace({
    ruleId: 'USACE-01', paragraph: '3.3.2', category: 'Durations', severity: 'medium', calculation: 'usace.maxDuration',
    title: 'Non-procurement activities are 20 work days or shorter',
    message: 'Activities other than procurement should have a duration of no more than 20 work days, so progress can be judged within a reporting period.',
  }, {
    threshold: () => threshold('duration.long_days', USACE_MAX_DURATION_DAYS, 'days', 'max', 'published'),
    evaluate: ({ net }, t) => {
      const tasks = net.open.filter(a => a.type === 'task')
      if (!tasks.length) return notAssessable('There are no open tasks to test.')
      const long = tasks.filter(a => a.duration > t!.value)
      const excluded = long.filter(a => isProcurement(a, net))
      const off = long.filter(a => !isProcurement(a, net))
      return {
        result: off.length ? 'fail' : 'pass',
        metric: `${shareText(off.length, tasks.length)} open tasks longer than ${t!.value} work days`,
        evidence: codes(off),
        recommendation: off.length ? 'Split each listed activity into pieces of 20 work days or less. If one is procurement, name it so, and check your contract for any approved exception.' : 'No action needed.',
        reason: `Procurement activities are recognised by wording only, because the schedule data carries no activity codes: an activity counts as procurement when its name or WBS contains one of: ${PROCUREMENT_WORDS_TEXT}. ${excluded.length ? `${plural(excluded.length, 'longer activity', 'longer activities')} left out as procurement: ${codes(excluded).slice(0, 20).join(', ')}${excluded.length > 20 ? ' and more' : ''}.` : 'No longer activity was left out as procurement.'} Durations are tested in work days; the specification's alternative limit in calendar days is not tested.`,
      }
    },
  }),

  usace({
    ruleId: 'USACE-02', paragraph: '3.3.11', category: 'Logic', severity: 'high', calculation: 'usace.openEnds',
    title: 'Only the first and last activity are open-ended',
    message: 'The network may have two open ends: the first activity has no predecessor and the last has no successor. Every other activity needs both.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: () => threshold('logic.open_ends_count', 0, 'count', 'max', 'published'),
    evaluate: ({ net }) => {
      if (!net.open.length) return notAssessable(NO_OPEN)
      const off = openEnds(net)
      return {
        result: off.length ? 'fail' : 'pass',
        metric: `${plural(off.length, 'open activity', 'open activities')} missing a predecessor or successor, apart from ${net.startId ? net.code(net.startId) : 'the first activity'} and ${net.finishId ? net.code(net.finishId) : 'the last activity'}`,
        evidence: codes(off),
        recommendation: off.length ? 'Give each listed activity the predecessor and successor that really constrain it.' : 'No action needed.',
        reason: 'The first activity is the one with no predecessor that starts earliest; the last is the finish milestone with no successor.',
      }
    },
  }),

  usace({
    ruleId: 'USACE-03', paragraph: '3.3.11', category: 'Logic', severity: 'medium', calculation: 'usace.startAndFinishLogic',
    title: 'Each activity has a start-driving predecessor and a finish-driven successor',
    message: 'An activity needs a start-to-start or finish-to-start predecessor, and a finish-to-finish or finish-to-start successor, so both its start and its finish are tied into the network.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    evaluate: ({ net }) => {
      if (!net.links.length) return notAssessable('The schedule has no relationships between activities.')
      const off = danglingEnds(net)
      return {
        result: off.length ? 'fail' : 'pass',
        metric: plural(off.length, 'activity end', 'activity ends') + ' without the required relationship type',
        evidence: off,
        recommendation: off.length ? 'For each start listed add an SS or FS predecessor; for each finish listed add an FF or FS successor.' : 'No action needed.',
        reason: 'Tested on open activities that have at least one predecessor or successor (USACE-02 covers those with none). Milestones are not tested, nor is the start of an activity that has already started.',
      }
    },
  }),

  usace({
    ruleId: 'USACE-04', paragraph: '3.3.8', category: 'Constraints', severity: 'high', calculation: 'usace.prohibitedConstraints',
    title: 'No mandatory or zero-float constraints',
    message: 'Mandatory start and mandatory finish constraints, and constraints that force zero free float or zero total float, are not allowed: they replace logic with a fixed date.',
  }, {
    threshold: () => threshold('constraints.mandatory_count', 0, 'count', 'max', 'published'),
    evaluate: ({ net }) => {
      if (!net.open.length) return notAssessable(NO_OPEN)
      const off: string[] = []
      for (const a of net.open) {
        const raw = String(a.constraint?.type ?? '')
        const t = normalizeConstraintType(raw)
        if (t && MANDATORY.has(t)) off.push(`${a.code} (${t})`)
        else if (!t && ZERO_FLOAT.test(raw)) off.push(`${a.code} (${raw.trim()})`)
      }
      return {
        result: off.length ? 'fail' : 'pass',
        metric: `${plural(off.length, 'open activity', 'open activities')} with a mandatory or zero-float constraint`,
        evidence: off,
        recommendation: off.length ? 'Remove each listed constraint and add the logic that really sets the date.' : 'No action needed.',
        reason: 'Mandatory start (MSO) and mandatory finish (MFO) constraints are tested on every file. Zero-free-float and zero-total-float settings are flagged only when the schedule data names them; RunF9 does not keep that setting from every file format, so finding none here does not show the file has none.',
      }
    },
  }),

  usace({
    ruleId: 'USACE-05', paragraph: '3.3.8', category: 'Constraints', severity: 'medium', calculation: 'usace.otherConstraints',
    title: 'Other date constraints are ones the contract names',
    message: 'Apart from the completion date on the last activity, a constrained date is allowed only where the contract specifies it. RunF9 lists every other constraint for you to check against the contract.',
  }, {
    evaluate: ({ net }) => {
      if (!net.open.length) return notAssessable(NO_OPEN)
      const off = net.open.flatMap(a => {
        const t = normalizeConstraintType(a.constraint?.type)
        return t && !MANDATORY.has(t) && a.id !== net.finishId ? [`${a.code} (${t}${isValidDate(a.constraint?.date) ? ` ${fmtDate(a.constraint!.date)}` : ''})`] : []
      })
      return {
        result: off.length ? 'warning' : 'pass',
        metric: `${plural(off.length, 'open activity', 'open activities')} with a date constraint other than mandatory`,
        evidence: off,
        recommendation: off.length ? 'Check each listed constraint against the dates your contract specifies. Remove any that the contract does not name and let logic set the date.' : 'No action needed.',
        reason: 'This is a warning, never a fail: RunF9 cannot read which dates the contract specifies. The last activity is left out (USACE-06 covers its completion date) and mandatory constraints are reported by USACE-04.',
      }
    },
  }),

  usace({
    ruleId: 'USACE-06', paragraph: '3.3.8.2', category: 'Constraints', severity: 'medium', calculation: 'usace.completionDateOnLastActivity',
    title: 'The last activity carries the required completion date',
    message: 'The last activity should be constrained to the contract completion date, so the longest path shows positive or negative float against that date.',
  }, {
    evaluate: ({ net }) => {
      const last = net.finishId ? net.byId.get(net.finishId) : undefined
      if (!last) return notAssessable('The last activity of the network could not be identified.')
      if (net.isComplete(last)) return notAssessable(`${last.code}, the last activity, is complete.`)
      const t = normalizeConstraintType(last.constraint?.type)
      const own = t && isValidDate(last.constraint?.date) ? `${t} ${fmtDate(last.constraint!.date)}` : null
      const required = isValidDate(net.input.schedule.mustFinishBy) ? `project required finish ${fmtDate(net.input.schedule.mustFinishBy)}` : null
      const has = own ?? required
      return {
        result: has ? 'pass' : 'warning',
        metric: has ? `${last.code}: ${has}` : `${last.code} has no completion date constraint`,
        evidence: [last.code],
        recommendation: has ? 'No action needed.' : `Put a finish constraint with the contract completion date on ${last.code}, or set the project's required finish date.`,
        reason: 'RunF9 checks that a date is set; it cannot check that the date is the one in the contract.',
      }
    },
  }),

  usace({
    ruleId: 'USACE-07', paragraph: '3.3.16', category: 'Logic', severity: 'high', calculation: 'usace.leads',
    title: 'No leads (negative lags)',
    message: 'A relationship with a negative lag is not allowed: it lets the successor start before the logic says it can.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: () => threshold('logic.leads_count', 0, 'count', 'max', 'published'),
    evaluate: ({ net }) => {
      const into = linksIntoOpen(net)
      if (!into.length) return notAssessable(NO_LINKS)
      const leads = into.filter(l => l.lag < 0)
      return {
        result: leads.length ? 'fail' : 'pass',
        metric: `${plural(leads.length, 'lead')} on ${plural(into.length, 'relationship')}`,
        evidence: uniq(leads.map(l => linkText(net, l, `${l.lag}d`))),
        recommendation: leads.length ? 'Replace each lead with SS or FF logic, or split the predecessor so the overlap is explicit.' : 'No action needed.',
      }
    },
  }),

  usace({
    ruleId: 'USACE-08', paragraph: '3.3.16', category: 'Logic', severity: 'high', calculation: 'usace.startToFinish',
    title: 'No start-to-finish relationships',
    message: 'Start-to-finish relationships are not allowed: the successor finishes when the predecessor starts, which reverses the normal order of work.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: () => threshold('logic.sf_count', 0, 'count', 'max', 'published'),
    evaluate: ({ net }) => {
      const into = linksIntoOpen(net)
      if (!into.length) return notAssessable(NO_LINKS)
      const sf = into.filter(l => l.type === 'SF')
      return {
        result: sf.length ? 'fail' : 'pass',
        metric: `${plural(sf.length, 'start-to-finish relationship')} on ${plural(into.length, 'relationship')}`,
        evidence: uniq(sf.map(l => linkText(net, l, 'SF'))),
        recommendation: sf.length ? 'Replace each start-to-finish relationship with finish-to-start, start-to-start or finish-to-finish logic.' : 'No action needed.',
      }
    },
  }),

  usace({
    ruleId: 'USACE-09', paragraph: '3.3.13', category: 'Status', severity: 'medium', calculation: 'usace.outOfSequence',
    title: 'Progress follows the logic',
    message: 'Work recorded out of sequence (started before its predecessor relationship allowed) needs the Contracting Officer\'s approval. RunF9 lists each case.',
    applicability: { subjects: ['schedule'], requires: ['logic', 'progress'] },
  }, {
    evaluate: ({ net }) => {
      if (!net.all.some(hasProgress)) return notAssessable('No progress has been recorded yet.')
      if (!net.links.length) return notAssessable('The schedule has no relationships between activities.')
      const off = outOfSequence(net)
      return {
        result: off.length ? 'warning' : 'pass',
        metric: `${plural(off.length, 'relationship')} progressed out of sequence`,
        evidence: uniq(off),
        recommendation: off.length ? 'Correct the logic so it matches how the work was done, or get approval for each listed case.' : 'No action needed.',
        reason: 'This is a warning, never a fail: RunF9 cannot see whether an approval was given. Finish-to-start and start-to-start relationships are tested, from actual dates.',
      }
    },
  }),

  usace({
    ruleId: 'USACE-10', paragraph: '3.5.4.3', category: 'Critical path', severity: 'medium', calculation: 'usace.longestPathIsCritical',
    title: 'The critical path is the longest path',
    message: 'The critical path is defined as the longest path through the network. If other activities have less total float than the longest path, a float-based critical filter shows something else.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic', 'float'] },
  }, {
    evaluate: ({ net }) => {
      const cpm = net.links.length ? net.cpm() : null
      if (!cpm) return notAssessable('A longest path cannot be calculated (no logic, or no project start or data date).')
      if (cpm.cycles.length) return notAssessable('The logic contains a loop, so the longest path is not reliable.', 'Break the logic loop and run the check again.')
      if (!cpm.longestPath.length) return notAssessable('No longest path to the finish was found.')
      const onPath = new Set(cpm.longestPath)
      const pathFloats = net.open.filter(a => onPath.has(a.id)).map(a => net.totalFloat(a)).filter((v): v is number => v !== null)
      if (!pathFloats.length) return notAssessable('Total float is not available for the open activities on the longest path.')
      const pathFloat = Math.min(...pathFloats)
      const off = net.open.flatMap(a => {
        const tf = net.totalFloat(a)
        return !onPath.has(a.id) && tf !== null && tf < pathFloat ? [`${a.code} (${tf}d)`] : []
      })
      const held = cpm.longestPathConstraint
      return {
        result: off.length || held ? 'warning' : 'pass',
        metric: `longest path ${net.code(cpm.longestPath[0])} → ${net.code(cpm.longestPath[cpm.longestPath.length - 1])} (${plural(cpm.longestPath.length, 'activity', 'activities')}, total float ${pathFloat}d); ${plural(off.length, 'activity', 'activities')} off it with less float`,
        evidence: [...(held ? [`${net.code(held.id)} (${held.type} holds the path)`] : []), ...off],
        recommendation: off.length || held ? 'Report the longest path as the critical path. Check why the listed activities have less float: a date constraint or a different calendar usually causes it.' : 'No action needed.',
        reason: `The longest path is RunF9's calculation from the logic; total float is ${net.all.some(a => a.totalFloat !== null && a.totalFloat !== undefined) ? 'the value stored in the file' : 'RunF9\'s calculation'}. Activities with the same float as the longest path (parallel critical paths) are not flagged.`,
      }
    },
  }),
]
