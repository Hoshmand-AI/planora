// Evaluators shared by the rule packs (GAO, USACE UFGS, PMI). Each returns the offenders for one
// measure on the shared Network, so two packs that test the same thing count it the same way and
// differ only in the limit they apply and how they report it. DCMA's own checks stay in
// src/lib/analysis/dcma.ts (the DCMA pack is an adapter over them).

import { isValidDate, toDayNumber } from '@/lib/planning/calendar'
import type { AnalyzableActivity, CpmLink } from '@/lib/planning/types'
import { DEFAULT_GAO_THRESHOLDS, type GaoThresholds } from './config'
import { uniq, type Network } from './network'
import { threshold, type EngineConfig } from './rule'
import type { ThresholdSpec } from './types'

export const codes = (xs: AnalyzableActivity[]) => uniq(xs.map(a => a.code))

export const hasProgress = (a: AnalyzableActivity) =>
  !!a.actualStart || !!a.actualFinish || (a.percentComplete ?? 0) > 0 || a.status === 'in_progress' || a.status === 'complete'

/**
 * A RunF9 screening threshold held in the organization's standards settings: 'runf9_default' unless
 * the organization changed it. No published source sets these numbers.
 */
export function screeningThreshold(cfg: EngineConfig, key: keyof GaoThresholds, metricKey: string, unit: ThresholdSpec['unit'], direction: ThresholdSpec['direction']): ThresholdSpec {
  const v = cfg.gao[key]
  return threshold(metricKey, v, unit, direction, v === DEFAULT_GAO_THRESHOLDS[key] ? 'runf9_default' : 'org_configured')
}

/** Relationships into open (not complete) scheduled activities: the population for lead, lag and type tests. */
export const linksIntoOpen = (net: Network): CpmLink[] => net.links.filter(l => net.openIds.has(l.to))

/** "A1 → A2" with an optional note, e.g. "(SF)" or "(-3d)". */
export const linkText = (net: Network, l: CpmLink, note = '') => `${net.code(l.from)} → ${net.code(l.to)}${note ? ` (${note})` : ''}`

/** Open activities with no predecessor or no successor, apart from the project start and finish. */
export const openEnds = (net: Network): AnalyzableActivity[] =>
  net.open.filter(a => (!net.preds.has(a.id) && a.id !== net.startId) || (!net.succs.has(a.id) && a.id !== net.finishId))

/**
 * Dangling ends of open activities: a start that has predecessors but none of them start-driving
 * (FS or SS), or a finish that has successors but none of them finish-driven (FS or FF). Milestones
 * are not tested (one date), nor is the start of an activity that has already started.
 */
export function danglingEnds(net: Network): string[] {
  const off: string[] = []
  for (const a of net.open) {
    if (a.type === 'milestone') continue
    const p = net.preds.get(a.id) ?? [], s = net.succs.get(a.id) ?? []
    const startDangles = !a.actualStart && p.length > 0 && !p.some(l => l.type === 'FS' || l.type === 'SS')
    const finishDangles = s.length > 0 && !s.some(l => l.type === 'FS' || l.type === 'FF')
    if (startDangles) off.push(`${a.code} (start)`)
    if (finishDangles) off.push(`${a.code} (finish)`)
  }
  return off
}

/** Relationships on which progress was recorded out of sequence (successor started before FS/SS logic allowed); one entry per relationship. */
export function outOfSequence(net: Network): string[] {
  const off: string[] = []
  for (const l of net.links) {
    const p = net.byId.get(l.from), s = net.byId.get(l.to)
    if (!p || !s || !isValidDate(s.actualStart)) continue
    const sStart = toDayNumber(s.actualStart)
    if (l.type === 'FS' && (!isValidDate(p.actualFinish) ? !net.isComplete(p) : toDayNumber(p.actualFinish) > sStart)) off.push(`${p.code} → ${s.code}`)
    else if (l.type === 'SS' && (!isValidDate(p.actualStart) || toDayNumber(p.actualStart) > sStart)) off.push(`${p.code} → ${s.code} (SS)`)
  }
  return off
}

/** Relationships to or from WBS summary activities (read from every link in the file). */
export function summaryLinks(net: Network): { summaries: Set<string>; links: CpmLink[] } {
  const summaries = new Set(net.every.filter(a => a.type === 'summary').map(a => a.id))
  return { summaries, links: net.rawLinks.filter(l => summaries.has(l.from) || summaries.has(l.to)) }
}

/** Open activities with a known total float (stored in the file, else calculated). */
export const openFloats = (net: Network): { a: AnalyzableActivity; tf: number }[] =>
  net.open.map(a => ({ a, tf: net.totalFloat(a) })).filter((x): x is { a: AnalyzableActivity; tf: number } => x.tf !== null)
