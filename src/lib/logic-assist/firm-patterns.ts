// The firm's own sequencing style, learned from its past schedules: which kinds of work it ties to
// which, and how (FS / SS / FF, typical lag). Each past project counts once per pair of work stages, so
// a project that splits drywall into 40 activities doesn't outvote one that has 4. Only the firm's own
// uploads that firm history accepts are read (db.getOrgHistoryLogic); nothing is learned across firms.
// Pure and deterministic.

import { classifyName, STAGE_BY_ID, type StageId } from './categories'
import { stageDistance } from './sequence'
import type { LogicActivity, LogicLink } from './suggest'

export type PatternLinkType = 'FS' | 'SS' | 'FF' | 'SF'

export interface SequencingPattern {
  from: StageId
  to: StageId
  fromLabel: string
  toLabel: string
  /** Past projects that tie this kind of work to that one */
  projects: number
  /** Past projects that have both kinds of work */
  of: number
  /** projects / of */
  share: number
  /** The relationship type the firm uses most for this pair, and in how many of the projects */
  type: PatternLinkType
  typeProjects: number
  /** Median lag (work days) of that type */
  lag: number
  /** RunF9's general trade order runs this way (directly or through other work); false = the firm's own habit */
  usual: boolean
}

export interface FirmSequencing {
  /** Past projects read */
  projectCount: number
  /** Links between two classified activities, over all projects */
  linksRead: number
  /** Patterns seen in at least MIN_PROJECTS projects and in at least half of those that have both kinds of work */
  patterns: SequencingPattern[]
  /** Share of the firm's links that overlap work (SS or FF), across projects */
  overlapShare: number | null
}

export interface PastProject { scheduleId: string; activities: LogicActivity[]; links: LogicLink[] }

export const MIN_PROJECTS = 2
const MIN_CONFIDENCE = 0.6
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0 }

/** Learn the firm's sequencing patterns from its past projects. */
export function learnSequencing(projects: PastProject[]): FirmSequencing {
  type Pair = { projects: Set<string>; types: Map<PatternLinkType, { projects: Set<string>; lags: number[] }> }
  const pairs = new Map<string, Pair>()
  const stagesIn = new Map<string, Set<StageId>>()
  let linksRead = 0, overlap = 0
  for (const p of projects) {
    const stage = new Map<string, StageId>()
    for (const a of p.activities) {
      if (a.activityType && a.activityType !== 'task' && a.activityType !== 'milestone') continue
      const c = classifyName(a.name, a.wbs)
      if (c.stage && !c.modifier && c.source === 'name' && c.confidence >= MIN_CONFIDENCE) stage.set(a.id, c.stage)
    }
    stagesIn.set(p.scheduleId, new Set(stage.values()))
    for (const l of p.links) {
      const s1 = stage.get(l.predecessorId), s2 = stage.get(l.successorId)
      if (!s1 || !s2 || s1 === s2) continue
      linksRead++
      const type = (['FS', 'SS', 'FF', 'SF'].includes(String(l.type)) ? l.type : 'FS') as PatternLinkType
      if (type === 'SS' || type === 'FF') overlap++
      const k = `${s1}>${s2}`
      const pair = pairs.get(k) ?? { projects: new Set(), types: new Map() }
      pair.projects.add(p.scheduleId)
      const t = pair.types.get(type) ?? { projects: new Set(), lags: [] }
      t.projects.add(p.scheduleId); t.lags.push(Math.round(Number(l.lag) || 0))
      pair.types.set(type, t)
      pairs.set(k, pair)
    }
  }
  const patterns: SequencingPattern[] = []
  for (const [k, pair] of pairs) {
    const [from, to] = k.split('>') as [StageId, StageId]
    const of = [...stagesIn.values()].filter(s => s.has(from) && s.has(to)).length
    const n = pair.projects.size
    if (n < MIN_PROJECTS || n / of < 0.5) continue
    const [type, t] = [...pair.types.entries()].sort((a, b) => b[1].projects.size - a[1].projects.size || (a[0] === 'FS' ? -1 : 1))[0]
    patterns.push({
      from, to, fromLabel: STAGE_BY_ID.get(from)?.label ?? from, toLabel: STAGE_BY_ID.get(to)?.label ?? to,
      projects: n, of, share: Math.round((n / of) * 100) / 100, type, typeProjects: t.projects.size, lag: Math.round(median(t.lags)),
      usual: stageDistance(from, to) !== null,
    })
  }
  patterns.sort((a, b) => b.projects - a.projects || b.share - a.share || a.fromLabel.localeCompare(b.fromLabel))
  return { projectCount: projects.length, linksRead, patterns, overlapShare: linksRead ? Math.round((overlap / linksRead) * 100) / 100 : null }
}

/** Pattern lookup by stage pair. */
export function patternIndex(f: FirmSequencing | null | undefined): Map<string, SequencingPattern> {
  return new Map((f?.patterns ?? []).map(p => [`${p.from}>${p.to}`, p]))
}

/** "SS +5d", "FS", "FF −2d" */
export const linkLabel = (type: string, lag: number) => `${type}${lag ? ` ${lag > 0 ? '+' : '−'}${Math.abs(lag)}d` : ''}`

/** Plain-English note for a suggestion that follows the firm's pattern. */
export function patternNote(p: SequencingPattern): string {
  return `Your firm tied ${p.fromLabel} → ${p.toLabel} in ${p.projects} of ${p.of} past projects${p.type !== 'FS' || p.lag ? `, usually ${linkLabel(p.type, p.lag)}` : ''}.`
}
