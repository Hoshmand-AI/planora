// PMI Practice Standard for Scheduling rule pack: checks drawn from the schedule analysis items the
// practice standard lists in its section 3.4, for the items RunF9's schedule data can test.
//
// The practice standard names what to look at; RunF9 takes no numeric limit from it. Where a rule
// needs a number (a share of relationships, a float value in days) the number is a RunF9 screening
// default held in the organization's standards settings, and the threshold says so ('runf9_default',
// or 'org_configured' once changed). Items the standard lists for review produce a warning, not a
// fail, unless a RunF9 screening limit is exceeded.
//
// This pack is about the published practice standard only. Credentials for people are not standards
// and are never a framework (see types.ts). Titles, messages and recommendations are RunF9's own
// paraphrases; sourceReference is a citation only.

import { isValidDate } from '@/lib/planning/calendar'
import { fmtDate } from '@/lib/format'
import { normalizeConstraintType } from '@/lib/analysis/dcma'
import { plural, shareText, sharePct, uniq } from './network'
import { notAssessable, threshold, type RuleDef } from './rule'
import { codes, hasProgress, linkText, linksIntoOpen, openEnds, openFloats, outOfSequence, screeningThreshold, summaryLinks } from './shared'
import type { RuleMeta } from './types'

export const PMI_VERSION = 'PMI Practice Standard for Scheduling, 2nd edition'
export const PMI_DISCLAIMER = 'These checks are drawn from the schedule analysis items listed in section 3.4 of the PMI Practice Standard for Scheduling (second edition), for the items that schedule data can test. RunF9 takes no numeric limits from the practice standard: every number used here is a RunF9 screening default, or your organization\'s setting, and each result says which. Results point a scheduler at what to review; they are not a statement that a schedule conforms to the practice standard. RunF9 is not affiliated with or endorsed by PMI.'

type Meta = Pick<RuleMeta, 'ruleId' | 'severity' | 'calculation' | 'title' | 'message' | 'category'> & Partial<Pick<RuleMeta, 'applicability' | 'version'>> & { section: string }
function pmi({ section, ...meta }: Meta, rest: Pick<RuleDef, 'evaluate'> & Partial<Pick<RuleDef, 'threshold' | 'parameters'>>): RuleDef {
  return {
    version: 1, kind: 'standard_guidance', applicability: { subjects: ['schedule', 'plan'] }, ...meta,
    framework: 'PMI_SCHEDULING', frameworkVersion: PMI_VERSION,
    sourceReference: `${PMI_VERSION}, section ${section}`,
    ...rest,
  }
}

const NO_OPEN = 'There are no open activities to test.'
const NO_LINKS = 'There are no relationships into open activities.'
const RUNF9_LIMIT = 'The limit is a RunF9 screening default (or your organization\'s setting), not a value from the practice standard.'

export const PMI_RULES: RuleDef[] = [
  pmi({
    ruleId: 'PMI-01', section: '3.4.7 (open-ended activities)', category: 'Logic', severity: 'high', calculation: 'pmi.openEnds',
    title: 'Open-ended activities',
    message: 'Apart from the project start and finish, an activity with no predecessor or no successor is open-ended: a delay there does not reach the dates that depend on it.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: cfg => screeningThreshold(cfg, 'openEndsMaxPct', 'logic.open_ends_pct', '%', 'max'),
    evaluate: ({ net }, t) => {
      if (!net.open.length) return notAssessable(NO_OPEN)
      const off = openEnds(net)
      const within = sharePct(off.length, net.open.length) <= t!.value
      return {
        result: off.length === 0 ? 'pass' : within ? 'warning' : 'fail',
        metric: `${shareText(off.length, net.open.length)} open activities missing a predecessor or successor`,
        evidence: codes(off),
        recommendation: off.length ? 'Tie each listed activity into the network with the predecessor or successor that really constrains it.' : 'No action needed.',
        reason: RUNF9_LIMIT,
      }
    },
  }),

  pmi({
    ruleId: 'PMI-02', section: '3.4.6 (date constraints)', category: 'Constraints', severity: 'medium', calculation: 'pmi.dateConstraints',
    title: 'Date constraints',
    message: 'A date constraint replaces or limits what the logic would calculate. Each one should be there for a reason the team can state.',
  }, {
    evaluate: ({ net }) => {
      if (!net.open.length) return notAssessable(NO_OPEN)
      const off = net.open.flatMap(a => {
        const t = normalizeConstraintType(a.constraint?.type)
        return t ? [`${a.code} (${t}${isValidDate(a.constraint?.date) ? ` ${fmtDate(a.constraint!.date)}` : ''})`] : []
      })
      const hard = net.open.filter(a => net.hardConstraint(a)).length
      return {
        result: off.length ? 'warning' : 'pass',
        metric: `${shareText(off.length, net.open.length)} open activities with a date constraint; ${hard} of them can override logic`,
        evidence: off,
        recommendation: off.length ? 'Review each listed constraint. Keep the ones a contract, permit or owner date requires and replace the rest with logic.' : 'No action needed.',
        reason: 'Every constraint type is listed, so this is a warning for review and never a fail. Constraints that can override logic are mandatory, start-on, finish-on and no-later-than types.',
      }
    },
  }),

  pmi({
    ruleId: 'PMI-03', section: '3.4.9 (leads and lags)', category: 'Logic', severity: 'medium', calculation: 'pmi.leads',
    title: 'Leads (negative lags)',
    message: 'A lead lets a successor start before its predecessor relationship would allow. Each one hides an overlap that should be visible as logic.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: () => threshold('logic.leads_count', 0, 'count', 'max', 'runf9_default'),
    evaluate: ({ net }) => {
      const into = linksIntoOpen(net)
      if (!into.length) return notAssessable(NO_LINKS)
      const leads = into.filter(l => l.lag < 0)
      return {
        result: leads.length ? 'warning' : 'pass',
        metric: `${plural(leads.length, 'lead')} on ${plural(into.length, 'relationship')}`,
        evidence: uniq(leads.map(l => linkText(net, l, `${l.lag}d`))),
        recommendation: leads.length ? 'Review each lead. Replace it with SS or FF logic, or split the work so the overlap is explicit.' : 'No action needed.',
        reason: `RunF9 flags any lead for review. ${RUNF9_LIMIT}`,
      }
    },
  }),

  pmi({
    ruleId: 'PMI-04', section: '3.4.9 (leads and lags)', category: 'Logic', severity: 'low', calculation: 'pmi.lags',
    title: 'Lags',
    message: 'A lag is time between two activities with no work and no status. Each one should stand for something real, such as curing or a review period.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: cfg => screeningThreshold(cfg, 'lagsMaxPct', 'logic.lags_share_pct', '%', 'max'),
    evaluate: ({ net }, t) => {
      const into = linksIntoOpen(net)
      if (!into.length) return notAssessable(NO_LINKS)
      const lags = into.filter(l => l.lag > 0)
      const over = sharePct(lags.length, into.length) > t!.value
      return {
        result: over ? 'warning' : 'pass',
        metric: `${shareText(lags.length, into.length)} relationships carry a positive lag`,
        evidence: uniq(lags.map(l => linkText(net, l, `+${l.lag}d`))),
        recommendation: over ? 'Record what each lag stands for, or replace it with an activity that can be statused.' : 'No action needed.',
        reason: RUNF9_LIMIT,
      }
    },
  }),

  pmi({
    ruleId: 'PMI-05', section: '3.4.10 (start-to-finish relationships)', category: 'Logic', severity: 'medium', calculation: 'pmi.startToFinish',
    title: 'Start-to-finish relationships',
    message: 'In a start-to-finish relationship the successor cannot finish until the predecessor starts. It is rarely what the work needs and is often entered by mistake.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    evaluate: ({ net }) => {
      const into = linksIntoOpen(net)
      if (!into.length) return notAssessable(NO_LINKS)
      const sf = into.filter(l => l.type === 'SF')
      return {
        result: sf.length ? 'warning' : 'pass',
        metric: `${plural(sf.length, 'start-to-finish relationship')} on ${plural(into.length, 'relationship')}`,
        evidence: uniq(sf.map(l => linkText(net, l, 'SF'))),
        recommendation: sf.length ? 'Check each listed relationship. Replace it with FS, SS or FF logic unless the work really runs that way.' : 'No action needed.',
      }
    },
  }),

  pmi({
    ruleId: 'PMI-06', section: '3.4.11 (links to and from summary activities)', category: 'Logic', severity: 'low', calculation: 'pmi.summaryLinks',
    title: 'Links to or from summary activities',
    message: 'A relationship on a summary activity ties logic to a roll-up rather than to the work, so the detailed dates and the summary dates can disagree.',
  }, {
    evaluate: ({ net }) => {
      const { summaries, links } = summaryLinks(net)
      return {
        result: links.length ? 'warning' : 'pass',
        metric: summaries.size ? `${plural(links.length, 'relationship')} on ${plural(summaries.size, 'summary activity', 'summary activities')}` : 'no summary activities in the schedule data',
        evidence: uniq(links.map(l => linkText(net, l))),
        recommendation: links.length ? 'Move each listed relationship down to the detailed activities it really connects.' : 'No action needed.',
      }
    },
  }),

  pmi({
    ruleId: 'PMI-07', section: '3.4.8 (out-of-sequence logic)', category: 'Status', severity: 'medium', calculation: 'pmi.outOfSequence',
    title: 'Out-of-sequence logic',
    message: 'Work that started before its predecessor relationship allowed means the logic no longer describes how the work is being done.',
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
        recommendation: off.length ? 'Revise the logic to match how the work is really proceeding, then reschedule.' : 'No action needed.',
        reason: 'Finish-to-start and start-to-start relationships are tested, from actual dates.',
      }
    },
  }),

  pmi({
    ruleId: 'PMI-08', section: '3.4 (level of effort activities)', category: 'Critical path', severity: 'medium', calculation: 'pmi.loeOnCriticalPath',
    title: 'Level-of-effort activities on the critical path',
    message: 'Level-of-effort work takes its dates from the work it supports. It should not show as critical, because it cannot drive the finish.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['float'] },
  }, {
    evaluate: ({ net }) => {
      const loe = net.every.filter(a => a.type === 'loe' && !net.isComplete(a))
      if (!loe.length) return notAssessable('The schedule data has no open activity typed as level of effort, so this cannot be tested. This is not a pass: support work may be typed as ordinary tasks.', 'If the schedule has level-of-effort work, type it as level of effort in the scheduling tool and export again.')
      const withTf = loe.filter(a => a.totalFloat !== null && a.totalFloat !== undefined)
      if (!withTf.length) return notAssessable('The level-of-effort activities carry no total float in the schedule data. RunF9 leaves level of effort out of its own calculation, so it cannot tell whether the file shows them as critical.')
      const off = withTf.filter(a => (a.totalFloat as number) <= 0)
      return {
        result: off.length ? 'warning' : 'pass',
        metric: `${shareText(off.length, withTf.length)} open level-of-effort activities with total float of zero or less`,
        evidence: off.map(a => `${a.code} (${a.totalFloat}d)`),
        recommendation: off.length ? 'Leave the listed activities out of critical path reports, and check that none of them is a predecessor of discrete work.' : 'No action needed.',
        reason: 'Critical here means a stored total float of zero or less, as the file reports it.',
      }
    },
  }),

  pmi({
    ruleId: 'PMI-09', section: '3.4.2 (total float and free float)', category: 'Float', severity: 'medium', calculation: 'pmi.totalFloat',
    title: 'Total float is reported and reasonable',
    message: 'Total float should be known for the open work. Negative float means a required date cannot be met as planned; very high float usually means missing logic.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['float'] },
  }, {
    threshold: cfg => screeningThreshold(cfg, 'highFloatDays', 'float.high_days', 'days', 'max'),
    evaluate: ({ net }, t) => {
      if (!net.open.length) return notAssessable(NO_OPEN)
      const withTf = openFloats(net)
      if (!withTf.length) return notAssessable('Total float is not available: the file stores none and it cannot be calculated (no project start or data date).')
      const neg = withTf.filter(x => x.tf < 0)
      const high = withTf.filter(x => x.tf > t!.value)
      const tfs = withTf.map(x => x.tf)
      return {
        result: neg.length || high.length ? 'warning' : 'pass',
        metric: `total float ${Math.min(...tfs)}d to ${Math.max(...tfs)}d on ${plural(withTf.length, 'open activity', 'open activities')}; ${neg.length} negative, ${high.length} above ${t!.value} work days`,
        evidence: [...neg, ...high].map(x => `${x.a.code} (${x.tf}d)`),
        recommendation: neg.length || high.length ? 'For negative float, plan the recovery or revisit the required date. For high float, check the successors of each listed activity for missing logic.' : 'No action needed.',
        reason: `Free float is not tested. ${RUNF9_LIMIT}`,
      }
    },
  }),
]
