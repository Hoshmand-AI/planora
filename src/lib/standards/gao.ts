// GAO Schedule Assessment Guide profile (GAO-16-89G): the ten best practices grouped under the four
// characteristics, each with one or more deterministic checks on data Planora already holds.
//
// GAO describes best practices; it does not publish numeric pass marks. Thresholds here are Planora
// screening defaults (configurable per organization) and are labelled as such on every result.
// Titles, messages and recommendations are Planora's own paraphrases; sourceReference is a citation.
// An automated scan is not a GAO compliance determination (see GAO_DISCLAIMER).

import { isValidDate, toDayNumber } from '@/lib/planning/calendar'
import type { AnalyzableActivity } from '@/lib/planning/types'
import { DEFAULT_GAO_THRESHOLDS, type GaoThresholds } from './config'
import { plural, shareText, sharePct, uniq } from './network'
import { notAssessable, threshold, type EngineConfig, type RuleDef } from './rule'
import type { Characteristic, RuleMeta, ThresholdSpec } from './types'

export const GAO_VERSION = 'GAO-16-89G'
export const GAO_DISCLAIMER = 'This is an automated screen of schedule data against practices described in the GAO Schedule Assessment Guide (GAO-16-89G). It is not a GAO assessment and not a determination of compliance with the guide: GAO assessments rely on documents, interviews and professional judgment that an automated scan cannot replace. Thresholds are Planora screening defaults unless your organization changed them.'

const BP_TITLES: Record<number, string> = {
  1: 'Capturing all activities',
  2: 'Sequencing all activities',
  3: 'Assigning resources to all activities',
  4: 'Establishing the durations of all activities',
  5: 'Verifying horizontal and vertical traceability',
  6: 'Confirming that the critical path is valid',
  7: 'Ensuring reasonable total float',
  8: 'Conducting a schedule risk analysis',
  9: 'Updating the schedule with actual progress and logic',
  10: 'Maintaining a baseline schedule',
}
export const GAO_BEST_PRACTICES: { bestPractice: number; title: string; characteristic: Characteristic }[] = [
  { bestPractice: 1, title: BP_TITLES[1], characteristic: 'comprehensive' },
  { bestPractice: 3, title: BP_TITLES[3], characteristic: 'comprehensive' },
  { bestPractice: 4, title: BP_TITLES[4], characteristic: 'comprehensive' },
  { bestPractice: 2, title: BP_TITLES[2], characteristic: 'well_constructed' },
  { bestPractice: 6, title: BP_TITLES[6], characteristic: 'well_constructed' },
  { bestPractice: 7, title: BP_TITLES[7], characteristic: 'well_constructed' },
  { bestPractice: 5, title: BP_TITLES[5], characteristic: 'credible' },
  { bestPractice: 8, title: BP_TITLES[8], characteristic: 'credible' },
  { bestPractice: 9, title: BP_TITLES[9], characteristic: 'controlled' },
  { bestPractice: 10, title: BP_TITLES[10], characteristic: 'controlled' },
]
const CHAR_OF = Object.fromEntries(GAO_BEST_PRACTICES.map(b => [b.bestPractice, b.characteristic])) as Record<number, Characteristic>

type Meta = Pick<RuleMeta, 'ruleId' | 'bestPractice' | 'severity' | 'calculation' | 'title' | 'message' | 'category'> & Partial<Pick<RuleMeta, 'kind' | 'applicability' | 'version'>>
function gao(meta: Meta, rest: Pick<RuleDef, 'evaluate'> & Partial<Pick<RuleDef, 'threshold' | 'parameters'>>): RuleDef {
  const bp = meta.bestPractice!
  return {
    version: 1, kind: 'standard_guidance', applicability: { subjects: ['schedule', 'plan'] }, ...meta,
    framework: 'GAO_SCHEDULE_GUIDE', frameworkVersion: GAO_VERSION, characteristic: CHAR_OF[bp],
    sourceReference: `${GAO_VERSION}, Best Practice ${bp} (${BP_TITLES[bp]})`,
    ...rest,
  }
}

/** A GAO screening threshold: 'planora_default' unless the organization changed it. */
function gt(cfg: EngineConfig, key: keyof GaoThresholds, metricKey: string, unit: ThresholdSpec['unit'], direction: ThresholdSpec['direction']): ThresholdSpec {
  const v = cfg.gao[key]
  return threshold(metricKey, v, unit, direction, v === DEFAULT_GAO_THRESHOLDS[key] ? 'planora_default' : 'org_configured')
}

const codes = (xs: AnalyzableActivity[]) => uniq(xs.map(a => a.code))
const hasProgress = (a: AnalyzableActivity) => !!a.actualStart || !!a.actualFinish || (a.percentComplete ?? 0) > 0 || a.status === 'in_progress' || a.status === 'complete'
const LOE_NAME = /\b(project management|project manager|supervision|superintend\w*|general conditions|general requirements|site management|level of effort|loe|overhead|project controls|administration|site security)\b/i

export const GAO_RULES: RuleDef[] = [
  /* ── BP1 Capturing all activities ───────────────────────────── */
  gao({
    ruleId: 'GAO-BP1-01', bestPractice: 1, category: 'Scope coverage', severity: 'medium', calculation: 'wbsCoverage',
    title: 'Work activities map to the WBS',
    message: 'Every work activity should belong to a work breakdown structure element so the schedule can be checked against the full scope.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['wbs'] },
  }, {
    threshold: cfg => gt(cfg, 'wbsMinCoveragePct', 'wbs.coverage_pct', '%', 'min'),
    evaluate: ({ net }, t) => {
      const wbs = net.input.wbs ?? {}
      if (!Object.values(wbs).some(v => !!v && v.trim())) return notAssessable('The schedule carries no WBS codes, so coverage of the scope cannot be measured.', 'Export the schedule with its WBS (P6 WBS or MS Project outline) and run the check again.')
      const missing = net.all.filter(a => !(wbs[a.id] ?? '').trim())
      const cov = 100 - sharePct(missing.length, net.all.length)
      const ok = cov >= t!.value
      return {
        result: ok ? 'pass' : cov >= t!.value - 15 ? 'warning' : 'fail',
        metric: `${cov.toFixed(1)}% of ${net.all.length} activities carry a WBS code`,
        evidence: codes(missing),
        recommendation: ok ? 'No action needed.' : 'Assign each listed activity to the WBS element whose scope it delivers; work with no WBS home often means scope is missing or duplicated.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP1-02', bestPractice: 1, category: 'Milestones', severity: 'medium', calculation: 'startFinishMilestones',
    title: 'Start and finish milestones are present',
    message: 'The network should open with a start milestone and close with a finish milestone so the whole effort sits between them.',
  }, {
    evaluate: ({ net }) => {
      const ms = net.all.filter(a => a.type === 'milestone')
      if (!ms.length) return { result: 'fail', metric: 'no milestones', evidence: [], recommendation: 'Add a start milestone (e.g. Notice to Proceed) and a finish milestone (e.g. Substantial or Final Completion) and tie the work to them.' }
      const start = ms.some(m => m.milestoneKind === 'start' || !net.preds.has(m.id))
      const finish = ms.some(m => m.milestoneKind === 'finish' && !net.succs.has(m.id)) || ms.some(m => !net.succs.has(m.id) && net.preds.has(m.id))
      const missing = [!start && 'start', !finish && 'finish'].filter(Boolean) as string[]
      return {
        result: missing.length ? 'warning' : 'pass',
        metric: `${plural(ms.length, 'milestone')}; ${missing.length ? `no ${missing.join(' or ')} milestone` : 'start and finish milestones present'}`,
        evidence: [],
        recommendation: missing.length ? `Add a ${missing.join(' and a ')} milestone and link it into the network.` : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP1-03', bestPractice: 1, category: 'Level of effort', severity: 'low', calculation: 'loeIdentification',
    title: 'Level-of-effort work is identified as such',
    message: 'Support work that lasts as long as the work it supports (management, supervision) should be typed as level of effort, not as discrete work that can drive dates.',
  }, {
    evaluate: ({ net }) => {
      const loe = net.every.filter(a => a.type === 'loe')
      const suspect = net.all.filter(a => a.type === 'task' && LOE_NAME.test(a.name))
      return {
        result: suspect.length ? 'warning' : 'pass',
        metric: `${plural(loe.length, 'LOE activity', 'LOE activities')} typed; ${plural(suspect.length, 'task')} named like support work`,
        evidence: codes(suspect),
        recommendation: suspect.length ? 'Check the listed tasks: if they only span the work they support, change them to level of effort so they cannot drive the finish.' : 'No action needed.',
      }
    },
  }),

  /* ── BP2 Sequencing all activities ─────────────────────────── */
  gao({
    ruleId: 'GAO-BP2-01', bestPractice: 2, category: 'Logic', severity: 'high', calculation: 'openEnds',
    title: 'No open ends',
    message: 'Apart from the project start and finish, every activity should have at least one predecessor and one successor.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: cfg => gt(cfg, 'openEndsMaxPct', 'logic.open_ends_pct', '%', 'max'),
    evaluate: ({ net }, t) => {
      if (!net.open.length) return notAssessable('There are no open activities to test.')
      const off = net.open.filter(a => (!net.preds.has(a.id) && a.id !== net.startId) || (!net.succs.has(a.id) && a.id !== net.finishId))
      const ok = sharePct(off.length, net.open.length) <= t!.value
      return {
        result: off.length === 0 ? 'pass' : ok ? 'warning' : 'fail',
        metric: `${shareText(off.length, net.open.length)} open activities missing a predecessor or successor`,
        evidence: codes(off),
        recommendation: off.length ? 'Tie each listed activity into the network with the predecessor or successor that really constrains it, so a slip there moves the dates that depend on it.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP2-02', bestPractice: 2, category: 'Logic', severity: 'medium', calculation: 'danglingLogic',
    title: 'No dangling starts or finishes',
    message: 'An activity whose start is driven only by finish-type links (or whose finish drives nothing) is dangling: a delay at that end is invisible to the network.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    evaluate: ({ net }) => {
      if (!net.links.length) return notAssessable('The schedule has no relationships between activities.')
      const off: string[] = []
      for (const a of net.open) {
        if (a.type === 'milestone') continue
        const p = net.preds.get(a.id) ?? [], s = net.succs.get(a.id) ?? []
        const startDangles = !a.actualStart && p.length > 0 && !p.some(l => l.type === 'FS' || l.type === 'SS')
        const finishDangles = s.length > 0 && !s.some(l => l.type === 'FS' || l.type === 'FF')
        if (startDangles) off.push(`${a.code} (start)`)
        if (finishDangles) off.push(`${a.code} (finish)`)
      }
      return {
        result: off.length ? 'fail' : 'pass',
        metric: `${plural(off.length, 'dangling end')}`,
        evidence: off,
        recommendation: off.length ? 'Add a start-type predecessor (FS or SS) for dangling starts and a finish-type successor (FS or FF) for dangling finishes.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP2-03', bestPractice: 2, category: 'Logic', severity: 'high', calculation: 'leads',
    title: 'No leads (negative lags)',
    message: 'Negative lags let a successor start before its predecessor logically allows and hide overlap assumptions.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: () => threshold('logic.leads_count', 0, 'count', 'max', 'planora_default'),
    evaluate: ({ net }) => {
      const into = net.links.filter(l => net.openIds.has(l.to))
      if (!into.length) return notAssessable('There are no relationships into open activities.')
      const leads = into.filter(l => l.lag < 0)
      return {
        result: leads.length ? 'fail' : 'pass',
        metric: `${plural(leads.length, 'lead')} on ${plural(into.length, 'relationship')}`,
        evidence: uniq(leads.map(l => `${net.code(l.from)} → ${net.code(l.to)} (${l.lag}d)`)),
        recommendation: leads.length ? 'Replace each lead with SS or FF logic (with a positive lag if needed) or split the work so the overlap is explicit.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP2-04', bestPractice: 2, category: 'Logic', severity: 'medium', calculation: 'lagUse',
    title: 'Lags are justified',
    message: 'A lag is time with no work and no status; GAO-style review expects each one to be justified or replaced by an activity.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: cfg => gt(cfg, 'lagsMaxPct', 'logic.lags_share_pct', '%', 'max'),
    evaluate: ({ net }, t) => {
      const into = net.links.filter(l => net.openIds.has(l.to))
      if (!into.length) return notAssessable('There are no relationships into open activities.')
      const lags = into.filter(l => l.lag > 0)
      const over = sharePct(lags.length, into.length) > t!.value
      return {
        result: over ? 'warning' : 'pass',
        metric: `${shareText(lags.length, into.length)} relationships carry a positive lag`,
        evidence: uniq(lags.map(l => `${net.code(l.from)} → ${net.code(l.to)} (+${l.lag}d)`)),
        recommendation: over ? 'Record a reason for each lag (cure, review period) or replace it with an activity that can be statused.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP2-05', bestPractice: 2, category: 'Logic', severity: 'low', calculation: 'relationshipTypes',
    title: 'Relationship types are mostly finish-to-start',
    message: 'Start-to-start and finish-to-finish links have their place, but heavy use (and any start-to-finish) makes the path hard to follow.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: cfg => gt(cfg, 'minFsPct', 'logic.fs_share_pct', '%', 'min'),
    evaluate: ({ net }, t) => {
      const into = net.links.filter(l => net.openIds.has(l.to))
      if (!into.length) return notAssessable('There are no relationships into open activities.')
      const fs = into.filter(l => l.type === 'FS').length
      const sf = into.filter(l => l.type === 'SF')
      const fsPct = sharePct(fs, into.length)
      const bad = fsPct < t!.value || sf.length > 0
      return {
        result: bad ? 'warning' : 'pass',
        metric: `${fsPct.toFixed(1)}% finish-to-start; ${plural(sf.length, 'start-to-finish link')}`,
        evidence: uniq(into.filter(l => l.type !== 'FS').map(l => `${net.code(l.from)} → ${net.code(l.to)} (${l.type})`)),
        recommendation: bad ? 'Review SS/FF links for a matching pair (SS with FF) and replace start-to-finish links unless the work truly requires them.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP2-06', bestPractice: 2, category: 'Constraints', severity: 'high', calculation: 'hardConstraints',
    title: 'Date constraints are minimal and justified',
    message: 'Constraints that override logic (mandatory, start/finish-on, no-later-than) should be rare and each one justified.',
  }, {
    threshold: cfg => gt(cfg, 'hardConstraintsMaxPct', 'constraints.hard_share_pct', '%', 'max'),
    evaluate: ({ net }, t) => {
      if (!net.open.length) return notAssessable('There are no open activities to test.')
      const hard = net.open.filter(a => net.hardConstraint(a))
      const share = sharePct(hard.length, net.open.length)
      return {
        result: hard.length === 0 ? 'pass' : share <= t!.value ? 'warning' : 'fail',
        metric: `${shareText(hard.length, net.open.length)} open activities with a hard constraint`,
        evidence: hard.map(a => `${a.code} (${net.hardConstraint(a)})`),
        recommendation: hard.length ? 'Replace each constraint with the logic that really drives the date, or document why the date is imposed (contract, permit, owner).' : 'No action needed.',
      }
    },
  }),

  /* ── BP3 Assigning resources ──────────────────────────────── */
  gao({
    ruleId: 'GAO-BP3-01', bestPractice: 3, category: 'Resources', severity: 'medium', calculation: 'resourceLoading',
    title: 'Open work has resources assigned',
    message: 'Resource assignments show the schedule can actually be staffed and equipped as drawn.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['resources'] },
  }, {
    threshold: cfg => gt(cfg, 'resourcesMinLoadedPct', 'resources.loaded_pct', '%', 'min'),
    evaluate: ({ net }, t) => {
      if (!net.all.some(a => a.resourceCount !== undefined && a.resourceCount !== null)) {
        return notAssessable('The schedule carries no resource data (for example a P6 file without resource assignments, or a generated plan). Resource loading cannot be judged from this data; this is not a pass.', 'If resources are planned, export the schedule with its resource assignments and run the check again.')
      }
      const work = net.open.filter(a => a.type === 'task' && a.duration > 0)
      if (!work.length) return notAssessable('There are no open tasks with duration.')
      const bare = work.filter(a => !(a.resourceCount && a.resourceCount > 0))
      const loaded = 100 - sharePct(bare.length, work.length)
      return {
        result: loaded >= t!.value ? 'pass' : 'fail',
        metric: `${loaded.toFixed(1)}% of ${work.length} open tasks have resources`,
        evidence: codes(bare),
        recommendation: loaded >= t!.value ? 'No action needed.' : 'Assign labor, equipment or cost resources to the listed tasks, or record why they need none.',
      }
    },
  }),

  /* ── BP4 Durations ────────────────────────────────────────── */
  gao({
    ruleId: 'GAO-BP4-01', bestPractice: 4, category: 'Durations', severity: 'medium', calculation: 'longDurations',
    title: 'Durations are short enough to manage',
    message: 'Long activities are hard to status and usually hide several pieces of work that should be planned separately.',
  }, {
    threshold: cfg => gt(cfg, 'longDurationMaxPct', 'duration.long_share_pct', '%', 'max'),
    parameters: cfg => [gt(cfg, 'longDurationDays', 'duration.long_days', 'days', 'max')],
    evaluate: ({ net, cfg }, t) => {
      const tasks = net.open.filter(a => a.type === 'task')
      if (!tasks.length) return notAssessable('There are no open tasks to test.')
      const long = tasks.filter(a => (a.remaining ?? a.duration) > cfg.gao.longDurationDays)
      const share = sharePct(long.length, tasks.length)
      return {
        result: long.length === 0 ? 'pass' : share <= t!.value ? 'warning' : 'fail',
        metric: `${shareText(long.length, tasks.length)} open tasks longer than ${cfg.gao.longDurationDays} work days`,
        evidence: codes(long),
        recommendation: long.length ? 'Break the listed tasks into shorter pieces with their own logic, or record the basis of the long duration (e.g. a fabrication lead time).' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP4-02', bestPractice: 4, category: 'Durations', severity: 'low', calculation: 'zeroDurationTasks',
    title: 'Tasks have real durations',
    message: 'A task with zero duration is either a milestone typed wrongly or work with no estimate.',
  }, {
    evaluate: ({ net }) => {
      const tasks = net.open.filter(a => a.type === 'task')
      if (!tasks.length) return notAssessable('There are no open tasks to test.')
      const zero = tasks.filter(a => !(a.duration > 0))
      return {
        result: zero.length ? 'warning' : 'pass',
        metric: `${plural(zero.length, 'task')} with zero duration`,
        evidence: codes(zero),
        recommendation: zero.length ? 'Change the listed tasks to milestones, or give them an estimated duration with its basis.' : 'No action needed.',
      }
    },
  }),

  /* ── BP5 Traceability ─────────────────────────────────────── */
  gao({
    ruleId: 'GAO-BP5-01', bestPractice: 5, category: 'Vertical traceability', severity: 'medium', calculation: 'milestoneDetailTrace',
    title: 'Milestones trace to detailed work',
    message: 'Each interim and finish milestone should be reached by detailed work, so milestone dates come from the detail rather than being typed in.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    evaluate: ({ net }) => {
      const ms = net.open.filter(a => a.type === 'milestone' && a.id !== net.startId && a.milestoneKind !== 'start')
      if (!ms.length) return notAssessable('There are no open interim or finish milestones to trace.')
      const off = ms.filter(m => !(net.preds.get(m.id) ?? []).some(l => net.byId.get(l.from)?.type === 'task'))
      return {
        result: off.length ? 'fail' : 'pass',
        metric: `${shareText(off.length, ms.length)} open milestones with no detailed task driving them`,
        evidence: codes(off),
        recommendation: off.length ? 'Link the work that delivers each listed milestone as its predecessor; a milestone with no detail behind it is a date, not a forecast.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP5-02', bestPractice: 5, category: 'Vertical traceability', severity: 'low', calculation: 'summaryLogic',
    title: 'Logic sits on detail, not on summaries',
    message: 'Relationships to or from WBS summary activities break the link between summary and detail dates.',
  }, {
    evaluate: ({ net }) => {
      const summaries = new Set(net.every.filter(a => a.type === 'summary').map(a => a.id))
      const bad = net.rawLinks.filter(l => summaries.has(l.from) || summaries.has(l.to))
      return {
        result: bad.length ? 'warning' : 'pass',
        metric: summaries.size ? `${plural(bad.length, 'relationship')} on ${plural(summaries.size, 'summary activity', 'summary activities')}` : 'no WBS summary activities in the network',
        evidence: uniq(bad.map(l => `${net.code(l.from)} → ${net.code(l.to)}`)),
        recommendation: bad.length ? 'Move each listed relationship down to the detailed activities it really connects.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP5-03', bestPractice: 5, category: 'Horizontal traceability', severity: 'high', calculation: 'pathToFinish',
    title: 'All open work leads to the finish',
    message: 'Horizontal traceability means a delay anywhere flows through logic to the project finish; work with no path to the finish cannot move it.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    threshold: cfg => gt(cfg, 'unlinkedToFinishMaxPct', 'trace.unlinked_to_finish_pct', '%', 'max'),
    evaluate: ({ net }, t) => {
      if (!net.links.length || !net.finishId) return notAssessable('The schedule has no logic, so paths to the finish cannot be traced.')
      const reach = new Set<string>([net.finishId])
      const stack = [net.finishId]
      while (stack.length) {
        const id = stack.pop()!
        for (const l of net.preds.get(id) ?? []) if (!reach.has(l.from)) { reach.add(l.from); stack.push(l.from) }
      }
      const off = net.open.filter(a => !reach.has(a.id))
      const share = sharePct(off.length, net.open.length)
      return {
        result: off.length === 0 ? 'pass' : share <= t!.value ? 'warning' : 'fail',
        metric: `${shareText(off.length, net.open.length)} open activities with no logic path to ${net.code(net.finishId)}`,
        evidence: codes(off),
        recommendation: off.length ? 'Connect the listed work forward to the finish milestone through the activities it really feeds.' : 'No action needed.',
      }
    },
  }),

  /* ── BP6 Critical path ────────────────────────────────────── */
  gao({
    ruleId: 'GAO-BP6-01', bestPractice: 6, category: 'Critical path', severity: 'high', calculation: 'drivingPathContinuity',
    title: 'The driving path is continuous from start to finish',
    message: 'The longest path should run by logic from the start (or the data date) to the finish, without being held by a mandatory date or broken by a loop.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    evaluate: ({ net }) => {
      const cpm = net.links.length ? net.cpm() : null
      if (!cpm) return notAssessable('A critical path cannot be calculated (no logic or no project start / data date).')
      if (cpm.cycles.length) return { result: 'fail', metric: `${plural(cpm.cycles.length, 'logic loop')}`, evidence: uniq(cpm.cycles.flat().map(net.code)), recommendation: 'Break the logic loops; dates on a loop are not reliable.' }
      const path = cpm.longestPath
      if (!path.length) return { result: 'fail', metric: 'no driving path found', evidence: [], recommendation: 'Check that the finish milestone is linked to the work that delivers it.' }
      if (cpm.longestPathConstraint) {
        const c = cpm.longestPathConstraint
        return { result: 'fail', metric: `driving path stops at a ${c.type} constraint on ${net.code(c.id)}`, evidence: [net.code(c.id)], recommendation: 'Replace the mandatory constraint with the logic that drives the date so the critical path runs through the network.' }
      }
      const first = net.byId.get(path[0])
      const startsByLogic = !first || path[0] === net.startId || !!first.actualStart || !net.preds.has(path[0])
      const constrained = first && !first.actualStart && first.constraint?.type ? `${first.code} (${first.constraint.type})` : null
      return {
        result: startsByLogic && !constrained ? 'pass' : 'warning',
        metric: `${plural(path.length, 'activity', 'activities')} on the driving path, ${net.code(path[0])} → ${net.code(path[path.length - 1])}`,
        evidence: path.map(net.code),
        recommendation: startsByLogic && !constrained ? 'No action needed.' : `The driving path begins at ${constrained ?? net.code(path[0])}, which a date rather than logic holds. Confirm the constraint is real, or link the work that drives it.`,
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP6-02', bestPractice: 6, category: 'Critical path', severity: 'low', calculation: 'drivingPathLags',
    title: 'The driving path has no lags or leads',
    message: 'Lags on the driving path put time on the critical path that nobody can status or accelerate.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['logic'] },
  }, {
    evaluate: ({ net }) => {
      const cpm = net.links.length ? net.cpm() : null
      if (!cpm || !cpm.longestPath.length) return notAssessable('A driving path cannot be calculated.')
      const p = cpm.longestPath
      const bad: string[] = []
      for (let i = 1; i < p.length; i++) {
        for (const l of net.preds.get(p[i]) ?? []) if (l.from === p[i - 1] && l.lag !== 0) bad.push(`${net.code(l.from)} → ${net.code(l.to)} (${l.lag > 0 ? '+' : ''}${l.lag}d)`)
      }
      return {
        result: bad.length ? 'warning' : 'pass',
        metric: `${plural(bad.length, 'lag')} on the driving path`,
        evidence: bad,
        recommendation: bad.length ? 'Replace driving-path lags with activities (cure, review, delivery) that can be statused and managed.' : 'No action needed.',
      }
    },
  }),

  /* ── BP7 Total float ──────────────────────────────────────── */
  gao({
    ruleId: 'GAO-BP7-01', bestPractice: 7, category: 'Float', severity: 'medium', calculation: 'highFloat',
    title: 'High total float is justified',
    message: 'Unusually high float usually signals missing logic; any activity well above the screening value should have a reason.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['float'] },
  }, {
    threshold: cfg => gt(cfg, 'highFloatMaxPct', 'float.high_share_pct', '%', 'max'),
    parameters: cfg => [gt(cfg, 'highFloatDays', 'float.high_days', 'days', 'max')],
    evaluate: ({ net, cfg }, t) => {
      const withTf = net.open.map(a => ({ a, tf: net.totalFloat(a) })).filter((x): x is { a: AnalyzableActivity; tf: number } => x.tf !== null)
      if (!withTf.length) return notAssessable('Total float is not available.')
      const high = withTf.filter(x => x.tf > cfg.gao.highFloatDays)
      const over = sharePct(high.length, withTf.length) > t!.value
      return {
        result: over ? 'warning' : 'pass',
        metric: `${shareText(high.length, withTf.length)} open activities with total float above ${cfg.gao.highFloatDays} work days`,
        evidence: high.map(x => `${x.a.code} (${x.tf}d)`),
        recommendation: over ? 'Check the successors of each listed activity; add the missing logic, or record why the float is genuine.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP7-02', bestPractice: 7, category: 'Float', severity: 'high', calculation: 'negativeFloat',
    title: 'No negative float',
    message: 'Negative float means the plan cannot meet a required date as drawn.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['float'] },
  }, {
    threshold: () => threshold('float.negative_count', 0, 'count', 'max', 'planora_default'),
    evaluate: ({ net }) => {
      const withTf = net.open.map(a => ({ a, tf: net.totalFloat(a) })).filter((x): x is { a: AnalyzableActivity; tf: number } => x.tf !== null)
      if (!withTf.length) return notAssessable('Total float is not available.')
      const neg = withTf.filter(x => x.tf < 0)
      return {
        result: neg.length ? 'fail' : 'pass',
        metric: `${plural(neg.length, 'open activity', 'open activities')} with negative float`,
        evidence: neg.map(x => `${x.a.code} (${x.tf}d)`),
        recommendation: neg.length ? 'Prepare a recovery plan (resequencing, added resources) or seek a revised required date; do not remove the constraint just to clear the float.' : 'No action needed.',
      }
    },
  }),

  /* ── BP8 Schedule risk analysis ───────────────────────────── */
  gao({
    ruleId: 'GAO-BP8-01', bestPractice: 8, category: 'Risk analysis', severity: 'medium', calculation: 'sraOnRecord',
    title: 'A schedule risk analysis is on record',
    message: 'A schedule risk analysis with the team\'s own ranges and risk events shows how likely the dates are, not just what they are.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['risk_analysis'] },
  }, {
    evaluate: ({ net }) => {
      const r = net.input.riskAnalysis
      if (!r || r.ranges + r.events + (r.commitments ?? 0) === 0) {
        return notAssessable('No schedule risk analysis is on record for this schedule (no three-point ranges or risk events were entered). A run on default ranges alone is not evidence that the team analyzed risk.', 'Enter three-point ranges and risk events on the Risk view and run the Monte Carlo analysis.')
      }
      const dd = net.input.schedule.dataDate
      const stale = !!(r.recordedAt && isValidDate(dd) && toDayNumber(r.recordedAt.slice(0, 10)) < toDayNumber(dd))
      return {
        result: stale ? 'warning' : 'pass',
        metric: `${plural(r.ranges, 'range')}, ${plural(r.events, 'risk event')} recorded${r.recordedAt ? ` (${r.recordedAt.slice(0, 10)})` : ''}`,
        evidence: [],
        recommendation: stale ? 'The risk inputs predate this update\'s data date: review the ranges and events and run the analysis again.' : 'No action needed.',
        reason: `Source: ${r.source}`,
      }
    },
  }),

  /* ── BP9 Updating with actuals ────────────────────────────── */
  gao({
    ruleId: 'GAO-BP9-01', bestPractice: 9, category: 'Status', severity: 'high', calculation: 'dataDatePresent',
    title: 'The schedule has a data date',
    message: 'A status (data) date separates actual progress from forecast; without it progress cannot be judged.',
    applicability: { subjects: ['schedule'], requires: ['data_date'] },
  }, {
    evaluate: ({ net }) => {
      if (net.input.subject.kind === 'plan') return notAssessable('A generated plan has not been statused yet; the data date is its start.')
      const dd = net.input.schedule.dataDate
      return isValidDate(dd)
        ? { result: 'pass', metric: `data date ${dd}`, evidence: [], recommendation: 'No action needed.' }
        : { result: 'fail', metric: 'no data date', evidence: [], recommendation: 'Set the data date (status date) in the scheduling tool and re-export.' }
    },
  }),
  gao({
    ruleId: 'GAO-BP9-02', bestPractice: 9, category: 'Status', severity: 'high', calculation: 'futureActuals',
    title: 'No actual dates after the data date',
    message: 'Actual dates in the future are impossible and usually mean progress was entered against the wrong data date.',
    applicability: { subjects: ['schedule'], requires: ['data_date', 'progress'] },
  }, {
    evaluate: ({ net }) => {
      const dd = net.input.schedule.dataDate
      if (!isValidDate(dd)) return notAssessable('There is no data date to compare actual dates with.')
      if (!net.all.some(hasProgress)) return notAssessable('No progress has been recorded yet.')
      const d = toDayNumber(dd)
      const off = net.all.filter(a => (isValidDate(a.actualStart) && toDayNumber(a.actualStart) > d) || (isValidDate(a.actualFinish) && toDayNumber(a.actualFinish) > d))
      return {
        result: off.length ? 'fail' : 'pass',
        metric: `${plural(off.length, 'activity', 'activities')} with an actual date after ${dd}`,
        evidence: codes(off),
        recommendation: off.length ? 'Correct the actual dates or move the data date, then reschedule.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP9-03', bestPractice: 9, category: 'Status', severity: 'medium', calculation: 'outOfSequence',
    title: 'Progress follows the logic',
    message: 'Work that started before its finish-to-start predecessor finished means the logic no longer reflects how the work is being done.',
    applicability: { subjects: ['schedule'], requires: ['logic', 'progress'] },
  }, {
    evaluate: ({ net }) => {
      if (!net.all.some(hasProgress)) return notAssessable('No progress has been recorded yet.')
      if (!net.links.length) return notAssessable('The schedule has no logic.')
      const off: string[] = []
      for (const l of net.links) {
        const p = net.byId.get(l.from), s = net.byId.get(l.to)
        if (!p || !s || !isValidDate(s.actualStart)) continue
        const sStart = toDayNumber(s.actualStart)
        if (l.type === 'FS' && (!isValidDate(p.actualFinish) ? !net.isComplete(p) : toDayNumber(p.actualFinish) > sStart)) off.push(`${p.code} → ${s.code}`)
        else if (l.type === 'SS' && (!isValidDate(p.actualStart) || toDayNumber(p.actualStart) > sStart)) off.push(`${p.code} → ${s.code} (SS)`)
      }
      return {
        result: off.length ? 'warning' : 'pass',
        metric: `${plural(off.length, 'relationship')} progressed out of sequence`,
        evidence: uniq(off),
        recommendation: off.length ? 'Revise the logic to match how the work is really proceeding, then reschedule.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP9-04', bestPractice: 9, category: 'Status', severity: 'high', calculation: 'progressWithoutActuals',
    title: 'Progress carries actual dates',
    message: 'Started work needs an actual start and finished work an actual finish; percent complete alone is not status.',
    applicability: { subjects: ['schedule'], requires: ['progress'] },
  }, {
    evaluate: ({ net }) => {
      if (!net.all.some(hasProgress)) return notAssessable('No progress has been recorded yet.')
      const off: string[] = []
      for (const a of net.all) {
        const started = a.status === 'in_progress' || a.status === 'complete' || (a.percentComplete ?? 0) > 0
        if (started && !isValidDate(a.actualStart)) off.push(`${a.code} (no actual start)`)
        if (a.status === 'complete' && !isValidDate(a.actualFinish)) off.push(`${a.code} (no actual finish)`)
      }
      return {
        result: off.length ? 'fail' : 'pass',
        metric: `${plural(off.length, 'missing actual date')}`,
        evidence: off,
        recommendation: off.length ? 'Enter the actual start and finish dates for the listed activities.' : 'No action needed.',
      }
    },
  }),
  gao({
    ruleId: 'GAO-BP9-05', bestPractice: 9, category: 'Status', severity: 'high', calculation: 'forecastBeforeDataDate',
    title: 'No unstatused work before the data date',
    message: 'Forecast dates before the data date mean remaining work was not moved forward when the schedule was updated.',
    applicability: { subjects: ['schedule'], requires: ['data_date', 'progress'] },
  }, {
    evaluate: ({ net }) => {
      const dd = net.input.schedule.dataDate
      if (!isValidDate(dd)) return notAssessable('There is no data date.')
      if (!net.all.some(hasProgress)) return notAssessable('No progress has been recorded yet.')
      const d = toDayNumber(dd)
      const fd = net.input.schedule.fileDates ?? {}
      const off = net.open.filter(a => {
        const es = fd[a.id]?.earlyStart ?? a.earlyStart, ef = fd[a.id]?.earlyFinish ?? a.earlyFinish
        return (!a.actualStart && isValidDate(es) && toDayNumber(es) < d) || (isValidDate(ef) && toDayNumber(ef) < d)
      })
      return {
        result: off.length ? 'fail' : 'pass',
        metric: `${plural(off.length, 'open activity', 'open activities')} forecast before ${dd}`,
        evidence: codes(off),
        recommendation: off.length ? 'Status the listed activities (actuals or remaining duration) and reschedule so no remaining work sits before the data date.' : 'No action needed.',
      }
    },
  }),

  /* ── BP10 Baseline ────────────────────────────────────────── */
  gao({
    ruleId: 'GAO-BP10-01', bestPractice: 10, category: 'Baseline', severity: 'high', calculation: 'baselineDesignated',
    title: 'A baseline is designated',
    message: 'Progress and variance mean little without an agreed baseline to measure against.',
    applicability: { subjects: ['schedule', 'plan'], requires: ['baseline'] },
  }, {
    evaluate: ({ net }) => {
      const b = net.input.baseline
      if (b && b.source !== 'none') return { result: 'pass', metric: `baseline: ${b.label || b.source.replace(/_/g, ' ')}`, evidence: [], recommendation: 'No action needed.' }
      if (net.input.subject.kind === 'plan') return notAssessable('This plan has not been published; publishing it creates the baseline.', 'Publish the plan when it is approved.')
      return { result: 'fail', metric: 'no baseline', evidence: [], recommendation: 'Upload the approved baseline (label it Baseline or designate it) or include the P6 project baseline in the export.' }
    },
  }),
  gao({
    ruleId: 'GAO-BP10-02', bestPractice: 10, category: 'Baseline', severity: 'medium', calculation: 'baselineCoverage',
    title: 'Current work is covered by the baseline',
    message: 'Activities with no baseline dates (added since, or never baselined) cannot be measured for variance.',
    applicability: { subjects: ['schedule'], requires: ['baseline'] },
  }, {
    threshold: cfg => gt(cfg, 'baselineMinCoveragePct', 'baseline.coverage_pct', '%', 'min'),
    evaluate: ({ net }, t) => {
      const b = net.input.baseline
      if (!b || b.source === 'none') return notAssessable('There is no baseline to compare with.')
      const work = net.all
      if (!work.length) return notAssessable('There are no activities.')
      const missing = work.filter(a => !isValidDate(a.baselineFinish))
      const cov = 100 - sharePct(missing.length, work.length)
      return {
        result: cov >= t!.value ? 'pass' : 'warning',
        metric: `${cov.toFixed(1)}% of ${work.length} activities have baseline dates`,
        evidence: codes(missing),
        recommendation: cov >= t!.value ? 'No action needed.' : 'Record added work through change control and re-baseline it, or explain why the listed activities have no baseline.',
      }
    },
  }),
]
