// Canonical trade sequencing: which kind of work usually follows which, as a small directed graph of
// work stages, plus the specific rules for deliveries, submittals, permits, inspections and repeated
// work by location. Every rule returns a strength and a plain-English reason.

import { STAGE_BY_ID, verb, type Classification, type StageId } from './categories'
import { compareLocations, previousLocationGap, type Location, type LocationMatch } from './locations'

/** Direct "usually follows" edges between work stages (predecessor → successors). */
export const STAGE_EDGES: Readonly<Partial<Record<StageId, StageId[]>>> = {
  start: ['precon', 'permit', 'submittal', 'mobilize'],
  precon: ['permit', 'submittal', 'mobilize'],
  permit: ['mobilize', 'demo', 'earthwork'],
  submittal: ['procure'],
  mobilize: ['demo', 'earthwork'],
  demo: ['earthwork'],
  earthwork: ['utilities', 'deepfdn', 'foundation'],
  utilities: ['underslab', 'paving'],
  deepfdn: ['foundation'],
  foundation: ['cure', 'underslab', 'structure'],
  cure: ['sog', 'structure'],
  underslab: ['sog'],
  sog: ['structure'],
  structure: ['roofing', 'skin', 'mepEquip', 'framing', 'mepRough'],
  roofing: ['dryin'],
  skin: ['dryin'],
  dryin: ['drywall'],
  framing: ['mepRough'],
  mepEquip: ['power', 'cx'],
  mepRough: ['drywall', 'power'],
  power: ['cx', 'mepTrim'],
  drywall: ['finishes'],
  finishes: ['mepTrim', 'specialties', 'punch'],
  mepTrim: ['cx', 'punch'],
  specialties: ['punch'],
  paving: ['punch'],
  cx: ['inspection', 'punch'],
  inspection: ['completion'],
  punch: ['completion'],
  completion: ['closeoutDocs', 'final'],
  closeoutDocs: ['final'],
}

/** Shortest number of "usually follows" steps from stage a to stage b (null when b never follows a). */
const distCache = new Map<string, number | null>()
export function stageDistance(a: StageId, b: StageId): number | null {
  const k = `${a}>${b}`
  if (distCache.has(k)) return distCache.get(k)!
  let d: number | null = null
  if (a !== b) {
    const seen = new Set<StageId>([a])
    let frontier: StageId[] = [a]
    for (let step = 1; frontier.length && d === null; step++) {
      const next: StageId[] = []
      for (const x of frontier) for (const y of STAGE_EDGES[x] ?? []) {
        if (y === b) { d = step; break }
        if (!seen.has(y)) { seen.add(y); next.push(y) }
      }
      frontier = next
    }
  }
  distCache.set(k, d)
  return d
}

export type RelationRule = 'delivery_before_install' | 'submittal_before_procurement' | 'submittal_before_install' | 'permit_before_work'
  | 'work_before_inspection' | 'inspection_before_next' | 'next_location' | 'trade_sequence'

export interface Relation { rule: RelationRule; strength: number; reason: string; location: LocationMatch }

export interface Profiled { cls: Classification; loc: Location }

const label = (s: StageId | null) => (s ? STAGE_BY_ID.get(s)!.label : 'this work')
const cap = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s[0].toUpperCase() + s.slice(1))
/** "on Level 2", "in Area B", "in Building A, Level 2"; "" without a location */
export function whereText(loc: Location): string {
  if (!loc.tokens.length) return ''
  const first = loc.tokens[0]
  return `${first.kind === 'level' || first.kind === 'side' ? 'on' : 'in'} ${loc.tokens.length > 1 ? loc.label : first.label}${first.kind === 'side' ? ' side' : ''}`
}
/** The graph node of a classification: its stage, unless it is a trade-specific submittal / delivery / permit. */
const nodeOf = (c: Classification): StageId | null => (c.modifier && c.trade && c.modifier !== 'inspect' ? null : c.modifier === 'inspect' && c.trade ? null : c.stage)

const LOC_FACTOR: Record<LocationMatch, number> = { same: 1, none: 0.92, partial: 0.82, adjacent: 0.45, different: 0.3 }
export const locationFactor = (m: LocationMatch) => LOC_FACTOR[m]

/**
 * Does `s` usually follow `p`? The strongest applicable rule, with its reason, or null. Strength is
 * before the location factor and the classification confidence are applied.
 */
export function relation(p: Profiled, s: Profiled): Relation | null {
  const P = p.cls, S = s.cls
  if (!P.stage || !S.stage) return null
  const location = compareLocations(p.loc, s.loc)
  const where = location === 'same' || location === 'partial' ? whereText(location === 'same' ? s.loc : (s.loc.key ? s.loc : p.loc)) : ''
  const sfx = where ? ` ${where}` : ''
  const out = (rule: RelationRule, strength: number, reason: string): Relation => ({ rule, strength, reason, location })

  // Deliveries, submittals and permits of one trade come before that trade's work.
  if (P.modifier === 'procure' && P.trade && !S.modifier && S.stage === P.trade) return out('delivery_before_install', 0.95, `${cap(label(P.trade))} work usually starts once its materials are delivered${sfx}.`)
  if (P.modifier === 'submittal' && S.modifier === 'procure' && P.trade && P.trade === S.trade) return out('submittal_before_procurement', 0.9, `Ordering and fabrication usually follow the approved ${label(P.trade)} submittal.`)
  if (P.modifier === 'submittal' && P.trade && !S.modifier && S.stage === P.trade) return out('submittal_before_install', 0.6, `${cap(label(P.trade))} work needs its submittal approved first${sfx}.`)
  if (P.modifier === 'permit' && !S.modifier && (P.trade ? S.stage === P.trade : stageDistance('permit', S.stage) === 1)) return out('permit_before_work', 0.85, `${cap(label(S.stage))} usually ${verb(S.stage, 'waits', 'wait')} for its permit${sfx}.`)
  // Inspections sit between the work they inspect and what covers it up.
  if (S.modifier === 'inspect' && S.trade && !P.modifier && P.stage === S.trade) return out('work_before_inspection', 0.9, `The ${label(S.trade)} inspection follows the ${label(S.trade)} work${sfx}.`)
  if (P.modifier === 'inspect' && P.trade && !S.modifier && stageDistance(P.trade, S.stage) === 1) return out('inspection_before_next', 0.9, `${cap(label(S.stage))} usually ${verb(S.stage, 'follows', 'follow')} a passed ${label(P.trade)} inspection${sfx}.`)

  // The same work repeated by location: the next location follows the previous one.
  if (!P.modifier && !S.modifier && P.stage === S.stage && previousLocationGap(p.loc, s.loc) === 1) {
    return { rule: 'next_location', strength: 0.7, reason: `Same work, next location: ${label(S.stage)} ${whereText(s.loc)} usually ${verb(S.stage, 'follows', 'follow')} ${whereText(p.loc).replace(/^(on|in) /, '')}.`, location: 'adjacent' }
  }

  const a = nodeOf(P), b = nodeOf(S)
  if (!a || !b) return null
  const d = stageDistance(a, b)
  if (d === 1) return out('trade_sequence', 0.85, `${cap(label(b))} usually ${verb(b, 'follows', 'follow')} ${label(a)}${sfx}.`)
  if (d === 2) return out('trade_sequence', 0.6, `${cap(label(b))} ${verb(b, 'comes', 'come')} after ${label(a)} in the usual trade sequence${sfx}.`)
  if (d === 3) return out('trade_sequence', 0.4, `${cap(label(b))} ${verb(b, 'comes', 'come')} some steps after ${label(a)} in the usual trade sequence${sfx}.`)
  return null
}
