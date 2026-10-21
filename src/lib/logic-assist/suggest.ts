// Nora's logic helper: finds loose ends (activities with no predecessor or no successor), work tied
// only to the finish milestone, links that run against the usual trade order and links already implied
// by others; proposes a predecessor or successor for each loose end from canonical trade sequencing,
// location, neighbouring activities and the existing network. Every proposal is checked against the
// network plus the proposals accepted before it: none creates a logic loop, none duplicates a path
// that already exists. Deterministic, offline and explainable.

import type { Activity, Relationship } from '@/lib/db'
import { classifyName, verb, type Classification, type StageId } from './categories'
import { extractLocation, type Location } from './locations'
import { locationFactor, relation, stageDistance, whereText, type Profiled, type RelationRule } from './sequence'

export type LogicActivity = Pick<Activity, 'id' | 'activityId' | 'name'> & Partial<Pick<Activity, 'wbs' | 'activityType' | 'status' | 'milestoneKind'>>
export type LogicLink = Pick<Relationship, 'predecessorId' | 'successorId'> & Partial<Pick<Relationship, 'type' | 'lag'>>

export type SuggestionKind = 'missing_predecessor' | 'missing_successor' | 'completion_only' | 'out_of_sequence' | 'redundant_link'

export interface ActivityRef { id: string; code: string; name: string }
export interface LogicSuggestion {
  /** Stable id: "<predecessor id>><successor id>" (plus the kind for review items) */
  id: string
  kind: SuggestionKind
  /** add_link: a new finish-to-start link; review_link / remove_link are advisory */
  action: 'add_link' | 'review_link' | 'remove_link'
  predecessor: ActivityRef
  successor: ActivityRef
  type: 'FS'
  lag: 0
  /** 0..1 */
  confidence: number
  /** Plain English, about the kinds of work (no activity names): "Drywall usually follows MEP rough-in on Level 2." */
  reason: string
  /** What is wrong now, naming the activity */
  problem: string
  rule: RelationRule | 'project_start' | 'project_finish' | 'against_sequence' | 'implied'
  /** Activity ids whose loose end this closes */
  fixes: string[]
  /** Why the two activities were read as they were: matched terms per side */
  basis: { predecessor: string[]; successor: string[] }
}

export interface ActivityProfile {
  category: Classification['category']; categoryLabel: string; stageLabel: string; confidence: number
  terms: string[]; source: Classification['source']; location: string
}

export interface LogicAssistResult {
  summary: {
    activities: number
    /** Open work activities missing a predecessor or a successor (the project start and finish excluded) */
    looseEnds: number
    missingPredecessor: number
    missingSuccessor: number
    /** Activities whose only successor is the finish milestone */
    completionOnly: number
    /** Loose ends with a proposed fix */
    suggested: number
    unresolved: number
    /** Links to review (against the usual sequence) and links already implied by others */
    outOfSequence: number
    redundant: number
    projectStart: ActivityRef | null
    projectFinish: ActivityRef | null
  }
  suggestions: LogicSuggestion[]
  unresolved: (ActivityRef & { missing: 'predecessor' | 'successor' })[]
  profiles: Record<string, ActivityProfile>
}

export interface SuggestOptions {
  /** Drop proposals below this confidence (default 0.3) */
  minConfidence?: number
  /** Also look for completion-only, out-of-sequence and redundant links (default true) */
  suspicious?: boolean
  /** Redundant-link search is skipped above this many links (default 4000) */
  maxLinksForRedundancy?: number
}

const CLOSEOUT_STAGES = new Set<StageId>(['punch', 'inspection', 'cx', 'closeoutDocs', 'completion', 'final', 'paving', 'permit', 'start', 'precon'])
const round2 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
const isWork = (a: LogicActivity) => !a.activityType || a.activityType === 'task' || a.activityType === 'milestone'

/** Classify and locate every activity; unrecognised ones borrow the stage of their neighbours (sequencing context). */
export function profileActivities(acts: LogicActivity[], links: LogicLink[]): Map<string, Profiled> {
  const out = new Map<string, Profiled>()
  for (const a of acts) out.set(a.id, { cls: classifyName(a.name, a.wbs), loc: extractLocation(a.name, a.wbs) })
  const nbrs = new Map<string, string[]>()
  for (const l of links) {
    nbrs.set(l.predecessorId, [...(nbrs.get(l.predecessorId) ?? []), l.successorId])
    nbrs.set(l.successorId, [...(nbrs.get(l.successorId) ?? []), l.predecessorId])
  }
  for (const a of acts) {
    const p = out.get(a.id)!
    if (p.cls.stage) continue
    const counts = new Map<StageId, number>()
    for (const n of nbrs.get(a.id) ?? []) {
      const c = out.get(n)?.cls
      if (c?.stage && c.source === 'name' && !c.modifier) counts.set(c.stage, (counts.get(c.stage) ?? 0) + 1)
    }
    const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]
    if (best) {
      const n = (nbrs.get(a.id) ?? []).map(id => out.get(id)!.cls).find(c => c.stage === best[0])!
      p.cls = { ...n, confidence: round2(Math.min(0.4, n.confidence * 0.45)), terms: [`next to ${n.stageLabel} work`], source: 'neighbours' }
    }
  }
  return out
}

/** Directed graph with reachability, updated as proposals are accepted. */
class Graph {
  succ = new Map<string, Set<string>>()
  add(p: string, s: string) { (this.succ.get(p) ?? this.succ.set(p, new Set()).get(p)!).add(s) }
  reaches(from: string, to: string): boolean {
    if (from === to) return true
    const seen = new Set<string>([from]); const stack = [from]
    while (stack.length) {
      for (const y of this.succ.get(stack.pop()!) ?? []) {
        if (y === to) return true
        if (!seen.has(y)) { seen.add(y); stack.push(y) }
      }
    }
    return false
  }
}

interface Candidate { p: string; s: string; score: number; reason: string; rule: LogicSuggestion['rule'] }

/**
 * Suggest logic fixes for an uploaded schedule. Only task and milestone activities take part
 * (level-of-effort and summary activities are ignored); completed activities are not given new logic.
 */
export function suggestLogic(activities: LogicActivity[], relationships: LogicLink[], opts: SuggestOptions = {}): LogicAssistResult {
  const minConf = opts.minConfidence ?? 0.3
  const suspicious = opts.suspicious ?? true
  const acts = activities.filter(isWork)
  const byId = new Map(acts.map(a => [a.id, a]))
  const order = new Map(acts.map((a, i) => [a.id, i]))
  const links = relationships.filter(l => byId.has(l.predecessorId) && byId.has(l.successorId) && l.predecessorId !== l.successorId)
  const prof = profileActivities(acts, links)
  const ref = (id: string): ActivityRef => { const a = byId.get(id)!; return { id, code: a.activityId, name: a.name } }

  const graph = new Graph()
  const preds = new Map<string, string[]>(), succs = new Map<string, string[]>()
  for (const l of links) {
    graph.add(l.predecessorId, l.successorId)
    preds.set(l.successorId, [...(preds.get(l.successorId) ?? []), l.predecessorId])
    succs.set(l.predecessorId, [...(succs.get(l.predecessorId) ?? []), l.successorId])
  }
  const stageOf = (id: string) => prof.get(id)!.cls.stage

  // The project start and finish may legitimately have no predecessor / successor.
  const noPred = acts.filter(a => !preds.get(a.id)?.length)
  const noSucc = acts.filter(a => !succs.get(a.id)?.length)
  const start = noPred.find(a => stageOf(a.id) === 'start' || a.milestoneKind === 'start')
    ?? (noPred[0] && noPred[0] === acts[0] && acts[0].activityType === 'milestone' ? acts[0] : undefined)
  const finishCands = noSucc.filter(a => stageOf(a.id) === 'final' || stageOf(a.id) === 'completion' || a.milestoneKind === 'finish')
  const finish = finishCands.find(a => stageOf(a.id) === 'final') ?? finishCands[finishCands.length - 1]
    ?? (noSucc.length && noSucc[noSucc.length - 1] === acts[acts.length - 1] && acts[acts.length - 1].activityType === 'milestone' ? acts[acts.length - 1] : undefined)

  const open = (a: LogicActivity) => a.status !== 'complete'
  const needPred = new Set(noPred.filter(a => a !== start && open(a)).map(a => a.id))
  const needSucc = new Set(noSucc.filter(a => a !== finish && open(a)).map(a => a.id))
  const completionStages = new Set<StageId | null>(['completion', 'final'])
  const completionOnly = new Set(suspicious ? acts.filter(a => {
    const s = succs.get(a.id) ?? []
    const st = stageOf(a.id)
    return open(a) && a !== finish && s.length > 0 && !(st && CLOSEOUT_STAGES.has(st)) && !completionStages.has(st) && a.activityType !== 'milestone'
      && s.every(x => x === finish?.id || completionStages.has(stageOf(x)))
  }).map(a => a.id) : [])

  /** Score one candidate link p → s (before safety checks). */
  const score = (p: string, s: string): { score: number; reason: string; rule: RelationRule } | null => {
    const P = prof.get(p)!, S = prof.get(s)!
    const r = relation(P, S)
    if (!r) return null
    const confs = Math.sqrt(Math.max(0.05, Math.min(P.cls.confidence, S.cls.confidence)))
    let v = r.strength * (r.rule === 'next_location' ? 1 : locationFactor(r.location)) * confs
    const a = byId.get(p)!, b = byId.get(s)!
    if (a.wbs && a.wbs === b.wbs) v += 0.05                       // same WBS group
    if (needSucc.has(p) && needPred.has(s)) v += 0.05              // closes two loose ends at once
    if ((order.get(p) ?? 0) < (order.get(s) ?? 0)) v += 0.03       // agrees with the file's activity order
    return { score: Math.min(0.95, v), reason: r.reason, rule: r.rule }
  }
  const proximity = (x: string, y: string) => Math.abs((order.get(x) ?? 0) - (order.get(y) ?? 0))

  // Candidates per loose end, best first (ties: the nearest activity in the file's order).
  type Need = { subject: string; side: 'pred' | 'succ'; kind: SuggestionKind; cands: Candidate[] }
  const needs: Need[] = []
  const finishLike = (id: string) => id === finish?.id || completionStages.has(stageOf(id))
  for (const s of needPred) {
    const cands: Candidate[] = []
    for (const p of acts) {
      if (p.id === s) continue
      const sc = score(p.id, s)
      if (sc) cands.push({ p: p.id, s, ...sc })
    }
    cands.sort((x, y) => y.score - x.score || proximity(x.p, s) - proximity(y.p, s))
    if (start && start.id !== s) cands.push({ p: start.id, s, score: 0.32, rule: 'project_start', reason: 'Nothing drives this activity yet; tying it to the project start keeps it from floating free of the schedule.' })
    needs.push({ subject: s, side: 'pred', kind: 'missing_predecessor', cands: cands.slice(0, 12) })
  }
  for (const p of [...needSucc, ...completionOnly]) {
    const kind: SuggestionKind = needSucc.has(p) ? 'missing_successor' : 'completion_only'
    const cands: Candidate[] = []
    for (const s of acts) {
      if (s.id === p || (kind === 'completion_only' && finishLike(s.id))) continue
      const sc = score(p, s.id)
      if (sc) cands.push({ p, s: s.id, ...sc })
    }
    cands.sort((x, y) => y.score - x.score || proximity(p, x.s) - proximity(p, y.s))
    if (kind === 'missing_successor' && finish && finish.id !== p) cands.push({ p, s: finish.id, score: 0.32, rule: 'project_finish', reason: 'Nothing follows this activity yet; tying it to the project finish lets a delay show up on the finish date.' })
    needs.push({ subject: p, side: 'succ', kind, cands: cands.slice(0, 12) })
  }

  // Greedy: the most confident proposal first; each is checked against the network as it stands with
  // the proposals accepted before it (no loop, no path that already exists), then added to it.
  const accepted: LogicSuggestion[] = []
  const resolved = new Set<string>()
  const key = (n: Need) => `${n.side}:${n.subject}`
  const flat = needs.flatMap(n => n.cands.filter(c => c.score >= minConf).map((c, rank) => ({ n, c, rank })))
    .sort((x, y) => y.c.score - x.c.score || x.rank - y.rank)
  for (const { n: need, c } of flat) {
    if (resolved.has(key(need))) continue
    if (graph.reaches(c.s, c.p) || graph.reaches(c.p, c.s)) continue
    graph.add(c.p, c.s)
    const fixes: string[] = []
    if (needSucc.has(c.p) || completionOnly.has(c.p)) { resolved.add(`succ:${c.p}`); fixes.push(c.p) }
    if (needPred.has(c.s)) { resolved.add(`pred:${c.s}`); fixes.push(c.s) }
    resolved.add(key(need))
    const subj = ref(need.subject)
    const problem = need.kind === 'missing_predecessor' ? `${subj.code} ${subj.name} has no predecessor.`
      : need.kind === 'missing_successor' ? `${subj.code} ${subj.name} has no successor.`
        : `${subj.code} ${subj.name} leads only to the finish milestone.`
    accepted.push({
      id: `${c.p}>${c.s}`, kind: need.kind, action: 'add_link', predecessor: ref(c.p), successor: ref(c.s), type: 'FS', lag: 0,
      confidence: round2(c.score), reason: c.reason, problem, rule: c.rule, fixes,
      basis: { predecessor: prof.get(c.p)!.cls.terms, successor: prof.get(c.s)!.cls.terms },
    })
  }

  const unresolved = needs.filter(n => !resolved.has(key(n)) && n.kind !== 'completion_only')
    .map(n => ({ ...ref(n.subject), missing: n.side === 'pred' ? 'predecessor' as const : 'successor' as const }))

  // Advisory: links that run against the usual order, and finish-to-start links implied by others.
  const review: LogicSuggestion[] = []
  if (suspicious) {
    for (const l of links) {
      const P = prof.get(l.predecessorId)!, S = prof.get(l.successorId)!
      if (P.cls.source !== 'name' || S.cls.source !== 'name' || P.cls.modifier || S.cls.modifier || !P.cls.stage || !S.cls.stage || P.cls.stage === S.cls.stage) continue
      if (P.cls.confidence < 0.6 || S.cls.confidence < 0.6) continue
      const back = stageDistance(S.cls.stage, P.cls.stage)
      const loc = P.loc.key && S.loc.key && P.loc.key !== S.loc.key
      if (back === null || back > 3 || loc) continue
      const conf = round2((back === 1 ? 0.7 : back === 2 ? 0.6 : 0.5) * Math.sqrt(Math.min(P.cls.confidence, S.cls.confidence)))
      const where = whereText(S.loc.key ? S.loc : P.loc)
      review.push({
        id: `seq:${l.predecessorId}>${l.successorId}`, kind: 'out_of_sequence', action: 'review_link', predecessor: ref(l.predecessorId), successor: ref(l.successorId), type: 'FS', lag: 0,
        confidence: conf, reason: `${cap(S.cls.stageLabel)} usually ${verb(S.cls.stage, 'comes', 'come')} before ${P.cls.stageLabel}${where ? ` ${where}` : ''}; check this link's direction.`,
        problem: `${ref(l.predecessorId).code} → ${ref(l.successorId).code} runs against the usual trade order.`, rule: 'against_sequence', fixes: [],
        basis: { predecessor: P.cls.terms, successor: S.cls.terms },
      })
    }
    if (links.length <= (opts.maxLinksForRedundancy ?? 4000)) review.push(...redundantLinks(links, ref))
  }

  accepted.sort((x, y) => y.confidence - x.confidence)
  review.sort((x, y) => y.confidence - x.confidence)
  const profiles: Record<string, ActivityProfile> = {}
  for (const a of acts) {
    const p = prof.get(a.id)!
    profiles[a.id] = { category: p.cls.category, categoryLabel: p.cls.categoryLabel, stageLabel: p.cls.stageLabel, confidence: p.cls.confidence, terms: p.cls.terms, source: p.cls.source, location: p.loc.label }
  }
  const loose = new Set([...needPred, ...needSucc])
  return {
    summary: {
      activities: acts.length, looseEnds: loose.size, missingPredecessor: needPred.size, missingSuccessor: needSucc.size, completionOnly: completionOnly.size,
      suggested: [...loose].filter(id => resolved.has(`pred:${id}`) || resolved.has(`succ:${id}`)).length,
      unresolved: unresolved.length,
      outOfSequence: review.filter(r => r.kind === 'out_of_sequence').length, redundant: review.filter(r => r.kind === 'redundant_link').length,
      projectStart: start ? ref(start.id) : null, projectFinish: finish ? ref(finish.id) : null,
    },
    suggestions: [...accepted, ...review],
    unresolved,
    profiles,
  }
}

const cap = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s[0].toUpperCase() + s.slice(1))

/**
 * Transitive reduction, finish-to-start only: a link p → s (FS, lag ≥ 0) is implied when another path
 * of FS links with lags ≥ 0 already leads from p to s. Removing it changes no dates.
 */
export function redundantLinks(links: LogicLink[], ref: (id: string) => ActivityRef): LogicSuggestion[] {
  const fs = links.filter(l => (l.type ?? 'FS') === 'FS' && (l.lag ?? 0) >= 0)
  const succ = new Map<string, string[]>()
  for (const l of fs) succ.set(l.predecessorId, [...(succ.get(l.predecessorId) ?? []), l.successorId])
  const out: LogicSuggestion[] = []
  const seenPair = new Set<string>()
  for (const l of fs) {
    const k = `${l.predecessorId}>${l.successorId}`
    if (seenPair.has(k) || (l.lag ?? 0) !== 0) continue
    seenPair.add(k)
    // Search from p's other successors for s.
    const seen = new Set<string>([l.predecessorId]); let via: string | null = null
    const stack = (succ.get(l.predecessorId) ?? []).filter(x => x !== l.successorId).map(x => [x, x] as [string, string])
    while (stack.length && !via) {
      const [x, first] = stack.pop()!
      if (seen.has(x)) continue
      seen.add(x)
      for (const y of succ.get(x) ?? []) { if (y === l.successorId) { via = first; break } stack.push([y, first]) }
    }
    if (!via) continue
    out.push({
      id: `implied:${k}`, kind: 'redundant_link', action: 'remove_link', predecessor: ref(l.predecessorId), successor: ref(l.successorId), type: 'FS', lag: 0,
      confidence: 0.6, reason: `Already implied through ${ref(via).code}; removing it is optional, changes no dates and makes the logic easier to read.`,
      problem: `${ref(l.predecessorId).code} → ${ref(l.successorId).code} repeats a path that already exists.`, rule: 'implied', fixes: [], basis: { predecessor: [], successor: [] },
    })
  }
  return out
}

export type { Location }
