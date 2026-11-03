// Location tokens in activity names: "Level 2", "L2", "2nd Floor", "Area B", "Zone 3", "Bldg A",
// "North Wing", "Grid 1-5". Repetitive schedules repeat one work description per location, so logic
// has to link the right instances ("Drywall – Level 2" follows "MEP rough-in – Level 2").

import { foldText } from './abbreviations'

export type LocationKind = 'building' | 'wing' | 'level' | 'area' | 'side' | 'grid'

export interface LocationToken {
  kind: LocationKind
  /** Normalised value: "2", "B", "ROOF", "B1", "NORTH" */
  value: string
  /** Plain label: "Level 2", "Area B", "Building A", "North" */
  label: string
  /** Sort order within its kind (Level 1 < Level 2, Area A < Area B), when it has one */
  order: number | null
}

export interface Location {
  tokens: LocationToken[]
  /** Stable key, e.g. "building:A|level:2"; "" when the name has no location */
  key: string
  /** Plain label, e.g. "Building A, Level 2"; "" when none */
  label: string
  /** The location came from the WBS path, not the activity name */
  fromWbs: boolean
}

const KIND_ORDER: LocationKind[] = ['building', 'wing', 'level', 'area', 'side', 'grid']
const STOP = new Set(['of', 'to', 'at', 'in', 'on', 'an', 'by', 'or', 'as', 'is', 'it', 'up', 'do', 'go', 'no', 'and', 'the'])
const ORDINAL_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
const SIDES = ['northeast', 'northwest', 'southeast', 'southwest', 'north', 'south', 'east', 'west']

function orderOf(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value)
  if (/^[A-Z]$/.test(value)) return value.charCodeAt(0) - 64
  if (/^[A-Z]{2}$/.test(value) && value[0] === value[1]) return 26 + value.charCodeAt(0) - 64 // AA, BB
  if (/^\d+[A-Z]$/.test(value)) return Number(value.slice(0, -1)) + (value.charCodeAt(value.length - 1) - 64) / 100
  return null
}

function levelToken(raw: string): LocationToken | null {
  const v = raw.toUpperCase().replace(/^0+(?=\d)/, '')
  if (/^B\d$/.test(v)) return { kind: 'level', value: v, label: `Basement ${v.slice(1)}`, order: -Number(v.slice(1)) }
  if (/^P\d$/.test(v)) return { kind: 'level', value: v, label: `Parking ${v.slice(1)}`, order: -10 - Number(v.slice(1)) }
  if (!/^\d{1,3}$/.test(v)) return null
  return { kind: 'level', value: v, label: `Level ${v}`, order: Number(v) }
}

function valueToken(kind: LocationKind, raw: string, word: string): LocationToken | null {
  const low = raw.toLowerCase()
  if (STOP.has(low)) return null
  const v = raw.toUpperCase().replace(/^0+(?=\d)/, '')
  const name = kind === 'building' ? 'Building' : kind === 'wing' ? (word === 'tower' ? 'Tower' : 'Wing') : kind === 'area' ? word[0].toUpperCase() + word.slice(1) : 'Grid'
  return { kind, value: v, label: `${name} ${v}`, order: orderOf(v) }
}

/** Location tokens of one text (activity name or WBS path), in reading order, without duplicates. */
export function locationTokens(text: string): LocationToken[] {
  const s = foldText(text).replace(/[,;:()[\]]/g, ' ')
  const out: { at: number; t: LocationToken }[] = []
  const push = (at: number, t: LocationToken | null) => { if (t && !out.some(x => x.t.kind === t.kind && x.t.value === t.value)) out.push({ at, t }) }
  let m: RegExpExecArray | null

  // Levels: "Level 2", "Lvl 02", "Floor 3", "Flr 3", "L2", "L-2", "B1", "2nd floor", "second floor"
  const lvl = /\b(?:level|lvl|lev|floor|flr|fl)\s*[-#.]?\s*(\d{1,3}|b\d|p\d)\b/g
  while ((m = lvl.exec(s))) push(m.index, levelToken(m[1]))
  const short = /\bl\s?-?(\d{1,2})\b|\bb(\d)\b/g
  while ((m = short.exec(s))) push(m.index, m[2] ? levelToken(`b${m[2]}`) : levelToken(m[1]))
  const ord = /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:floor|level|flr|fl)\b/g
  while ((m = ord.exec(s))) push(m.index, levelToken(m[1]))
  const ordWord = /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:floor|level)\b/g
  while ((m = ordWord.exec(s))) push(m.index, levelToken(String(ORDINAL_WORDS[m[1]])))
  const ground = /\b(?:ground|grade)\s+(?:floor|level)\b/g
  while ((m = ground.exec(s))) push(m.index, levelToken('1'))
  const basement = /\bbasement\b(?!\s*\d)/g
  while ((m = basement.exec(s))) push(m.index, { kind: 'level', value: 'B1', label: 'Basement 1', order: -1 })
  const mezz = /\bmezz(?:anine)?\b/g
  while ((m = mezz.exec(s))) push(m.index, { kind: 'level', value: 'MEZZ', label: 'Mezzanine', order: 1.5 })
  const roof = /\b(?:roof\s+level|penthouse|rooftop\s+level)\b/g
  while ((m = roof.exec(s))) push(m.index, { kind: 'level', value: 'ROOF', label: 'Roof level', order: 999 })

  // Areas: "Area B", "Zone 3", "Sector 2", "Section A", "Bay 4", "Pod C", "Quadrant 1", "Seq 2"
  const area = /\b(area|zone|sector|section|bay|pod|quadrant|segment|sequence|seq)\s*[-#.]?\s*([a-z]{1,2}|\d{1,3}[a-z]?)\b/g
  while ((m = area.exec(s))) push(m.index, valueToken('area', m[2], m[1] === 'seq' ? 'sequence' : m[1]))

  // Buildings, towers, wings: "Building A", "Bldg 2", "Tower B", "Wing C", "North Wing"
  const bldg = /\b(building|bldg|bld|tower|wing|block)\s*[-#.]?\s*([a-z]{1,2}|\d{1,3})\b/g
  while ((m = bldg.exec(s))) push(m.index, valueToken(m[1] === 'tower' || m[1] === 'wing' ? 'wing' : 'building', m[2], m[1]))
  const sideWing = /\b(northeast|northwest|southeast|southwest|north|south|east|west)\s+(wing|tower|building)\b/g
  const sideWingAt = new Set<number>()
  while ((m = sideWing.exec(s))) {
    sideWingAt.add(m.index)
    const v = m[1].toUpperCase()
    push(m.index, { kind: m[2] === 'building' ? 'building' : 'wing', value: v, label: `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2][0].toUpperCase()}${m[2].slice(1)}`, order: null })
  }
  // Sides: "North", "East elevation"
  const side = new RegExp(`\\b(${SIDES.join('|')})\\b`, 'g')
  while ((m = side.exec(s))) if (!sideWingAt.has(m.index)) push(m.index, { kind: 'side', value: m[1].toUpperCase(), label: m[1][0].toUpperCase() + m[1].slice(1), order: null })

  // Grid lines: "Grid 1-5", "Gridlines A-D"
  // (foldText has already turned "1-5" into "1 5")
  const grid = /\bgrid(?:\s*lines?)?\s*(\d{1,3}|[a-z]{1,2})(?:(?:\s+(?:to|thru)\s+|\s+)(\d{1,3}|[a-z]{1,2})\b)?/g
  while ((m = grid.exec(s))) {
    if (STOP.has(m[1])) continue
    const v = (m[2] && !STOP.has(m[2]) ? `${m[1]}-${m[2]}` : m[1]).toUpperCase()
    push(m.index, { kind: 'grid', value: v, label: `Grid ${v}`, order: orderOf(v.split('-')[0]) })
  }
  return out.sort((x, y) => x.at - y.at).map(x => x.t)
}

function build(tokens: LocationToken[], fromWbs: boolean): Location {
  const sorted = [...tokens].sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind))
  return { tokens: sorted, key: sorted.map(t => `${t.kind}:${t.value}`).join('|'), label: sorted.map(t => t.label).join(', '), fromWbs }
}

/** The activity's location from its name, or (when the name has none) from its WBS path. */
export function extractLocation(name: string, wbs?: string | null): Location {
  const own = locationTokens(name)
  if (own.length || !wbs) return build(own, false)
  return build(locationTokens(wbs), true)
}

export type LocationMatch = 'same' | 'none' | 'partial' | 'adjacent' | 'different'

/**
 * How two locations relate: same key; neither has one; compatible (one contains the other, "Bldg A"
 * vs "Bldg A, Level 2", or they name different kinds, "Bldg A" vs "Level 1", or only one has a
 * location); next to each other ("Level 1" → "Level 2", same everything else); or different.
 */
export function compareLocations(a: Location, b: Location): LocationMatch {
  if (!a.key && !b.key) return 'none'
  if (a.key === b.key) return 'same'
  if (!a.key || !b.key) return 'partial'
  // Compatible when no kind of location is given with two different values ("Bldg A" vs "Level 1").
  const conflict = a.tokens.some(x => b.tokens.some(y => y.kind === x.kind && y.value !== x.value))
  if (!conflict) return 'partial'
  return previousLocationGap(a, b) !== null ? 'adjacent' : 'different'
}

/**
 * When `a` and `b` differ in exactly one ordered token of the same kind (and agree on the rest), the
 * step from a to b (+1: b is the next location after a). Otherwise null.
 */
export function previousLocationGap(a: Location, b: Location): number | null {
  if (a.tokens.length !== b.tokens.length || !a.tokens.length) return null
  let diff: number | null = null
  for (let i = 0; i < a.tokens.length; i++) {
    const x = a.tokens[i], y = b.tokens[i]
    if (x.kind !== y.kind) return null
    if (x.value === y.value) continue
    if (diff !== null || x.order === null || y.order === null) return null
    diff = y.order - x.order
  }
  return diff !== null && Math.abs(diff) <= 1.01 && diff !== 0 ? diff : null
}
