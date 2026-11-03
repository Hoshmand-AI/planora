import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { parseXER } from '@/lib/parsers/xer-parser'
import {
  ABBREVIATIONS, classifyName, compareLocations, extractLocation, normalizeName, previousLocationGap, redundantLinks,
  stageDistance, STAGE_EDGES, suggestLogic, suggestionsCsv, csvCell, type LogicActivity, type LogicLink, type StageId,
} from './index'

/* ─── Helpers ─────────────────────────────────────────── */

const act = (code: string, name: string, extra: Partial<LogicActivity> = {}): LogicActivity => ({ id: `id-${code}`, activityId: code, name, activityType: 'task', status: 'not_started', ...extra })
const ms = (code: string, name: string, kind: 'start' | 'finish') => act(code, name, { activityType: 'milestone', milestoneKind: kind })
const link = (p: string, s: string, type: LogicLink['type'] = 'FS', lag = 0): LogicLink => ({ predecessorId: `id-${p}`, successorId: `id-${s}`, type, lag })
const pairs = (r: ReturnType<typeof suggestLogic>) => r.suggestions.filter(x => x.action === 'add_link').map(x => `${x.predecessor.code}>${x.successor.code}`)

/** Is the network (links plus accepted suggestions) acyclic? */
function acyclic(acts: LogicActivity[], links: LogicLink[]): boolean {
  const succ = new Map<string, string[]>()
  for (const l of links) succ.set(l.predecessorId, [...(succ.get(l.predecessorId) ?? []), l.successorId])
  const state = new Map<string, number>()
  const visit = (x: string): boolean => {
    if (state.get(x) === 1) return false
    if (state.get(x) === 2) return true
    state.set(x, 1)
    for (const y of succ.get(x) ?? []) if (!visit(y)) return false
    state.set(x, 2)
    return true
  }
  return acts.every(a => visit(a.id))
}
const withSuggestions = (links: LogicLink[], r: ReturnType<typeof suggestLogic>) =>
  [...links, ...r.suggestions.filter(x => x.action === 'add_link').map(x => ({ predecessorId: x.predecessor.id, successorId: x.successor.id }))]

/* ─── Abbreviations & normalisation ───────────────────── */

describe('abbreviations', () => {
  it('has a realistic dictionary (80+ entries, unique, lower case)', () => {
    expect(ABBREVIATIONS.length).toBeGreaterThanOrEqual(80)
    const keys = ABBREVIATIONS.map(a => a.abbr)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toBe(k.toLowerCase())
  })

  it.each([
    ['F/R/P SOG - Area B', 'form rebar pour slab on grade area b'],
    ['Install RTUs', 'install rooftop units'],
    ['MEP Rough-In L2', 'mechanical electrical plumbing rough in l2'],
    ['Hang GWB', 'hang gypsum wall board'],
    ['U/G Plumbing', 'underground plumbing'],
    ['E&S Controls', 'erosion and sediment control controls'],
    ['Steel Shop Dwgs', 'steel shop drawings'],
    ['FF&E Install', 'furniture fixtures and equipment install'],
    ['Set AHU-1', 'set air handling unit 1'],
    ['TAB', 'testing adjusting balancing'],
    ['CMU Walls', 'concrete masonry unit walls'],
    ['NTP', 'notice to proceed'],
    ['VCT/Carpet L1', 'vinyl composition tile carpet l1'],
    ['Hang/Tape GWB', 'hang tape gypsum wall board'],
  ])('expands %s', (name, text) => {
    expect(normalizeName(name).text).toBe(text)
  })

  it('reports what it expanded', () => {
    expect(normalizeName('Pour SOG').expansions).toEqual([{ abbr: 'sog', full: 'slab on grade' }])
  })

  it('expands whole-name-only abbreviations only when they are the whole name', () => {
    expect(normalizeName('SC').text).toBe('substantial completion')
    expect(normalizeName('SC Paving Crew').text).toBe('sc paving crew')
    expect(normalizeName('FRP').text).toBe('form rebar pour')
    expect(normalizeName('FRP Panels').text).toBe('frp panels')
  })

  it('leaves unknown tokens and casing noise alone', () => {
    expect(normalizeName('  PROCESS   Widget  ').text).toBe('process widget')
    expect(normalizeName('').text).toBe('')
  })
})

/* ─── Locations ───────────────────────────────────────── */

describe('location tokens', () => {
  it.each([
    ['Drywall - Level 2', 'level:2', 'Level 2'],
    ['Drywall L2', 'level:2', 'Level 2'],
    ['Drywall L-02', 'level:2', 'Level 2'],
    ['Paint 3rd Floor', 'level:3', 'Level 3'],
    ['Paint Second Floor', 'level:2', 'Level 2'],
    ['Flr 4 Ceiling Grid', 'level:4', 'Level 4'],
    ['Pour SOG Area B', 'area:B', 'Area B'],
    ['Steel Zone 3', 'area:3', 'Zone 3'],
    ['Sector 2 paving', 'area:2', 'Sector 2'],
    ['Bldg A Roofing', 'building:A', 'Building A'],
    ['Building 2 - Level 3 Drywall', 'building:2|level:3', 'Building 2, Level 3'],
    ['North Wing Framing', 'wing:NORTH', 'North Wing'],
    ['Brick Veneer East', 'side:EAST', 'East'],
    ['Basement Waterproofing', 'level:B1', 'Basement 1'],
    ['B2 Slab', 'level:B2', 'Basement 2'],
    ['Ground Floor Slab', 'level:1', 'Level 1'],
    ['Erect Steel Grid 1-5', 'grid:1-5', 'Grid 1-5'],
  ])('%s → %s', (name, key, label) => {
    const loc = extractLocation(name)
    expect(loc.key).toBe(key)
    expect(loc.label).toBe(label)
  })

  it('does not read ordinary words as locations', () => {
    for (const n of ['Install Rooftop Unit 2', 'Area of Refuge Signage', 'Building Permit', 'Level Floor Slab', 'Pour Slab on Grade', 'Bay Window Install']) {
      expect(extractLocation(n).key, n).toBe('')
    }
  })

  it('falls back to the WBS path', () => {
    const loc = extractLocation('Hang Drywall', 'Riverside > Building A > Level 2')
    expect(loc.key).toBe('building:A|level:2')
    expect(loc.fromWbs).toBe(true)
    expect(extractLocation('Hang Drywall L3', 'Building A > Level 2').key).toBe('level:3')
  })

  it('compares locations', () => {
    const L = (n: string) => extractLocation(n)
    expect(compareLocations(L('Drywall L2'), L('MEP L2'))).toBe('same')
    expect(compareLocations(L('Drywall'), L('MEP'))).toBe('none')
    expect(compareLocations(L('Drywall L2'), L('MEP'))).toBe('partial')
    expect(compareLocations(L('Bldg A L2'), L('Bldg A'))).toBe('partial')
    expect(compareLocations(L('Erect Steel Bldg A'), L('Framing L1'))).toBe('partial')
    expect(compareLocations(L('Drywall L2'), L('Drywall L3'))).toBe('adjacent')
    expect(compareLocations(L('Drywall L2'), L('Drywall L5'))).toBe('different')
    expect(compareLocations(L('Pour Area A'), L('Pour Zone 3'))).toBe('different')
    expect(previousLocationGap(L('Steel Area A'), L('Steel Area B'))).toBe(1)
    expect(previousLocationGap(L('Steel Area B'), L('Steel Area A'))).toBe(-1)
    expect(previousLocationGap(L('Bldg A L1'), L('Bldg B L2'))).toBeNull()
  })
})

/* ─── Categories ──────────────────────────────────────── */

describe('category classifier', () => {
  it.each([
    ['Notice to Proceed', 'general', 'start'],
    ['Mobilize & Site Setup', 'general', 'mobilize'],
    ['Building Permit', 'permits', 'permit'],
    ['Steel Shop Drawings', 'procurement', 'submittal'],
    ['Deliver Structural Steel', 'procurement', 'procure'],
    ['Mass Excavation', 'sitework', 'earthwork'],
    ['Site Utilities - Storm', 'sitework', 'utilities'],
    ['Spread Footings', 'concrete', 'foundation'],
    ['F/R/P SOG - Area B', 'concrete', 'sog'],
    ['Cure Footings', 'concrete', 'cure'],
    ['Erect Structural Steel', 'structure', 'structure'],
    ['CMU Walls', 'structure', 'structure'],
    ['TPO Roofing', 'envelope', 'roofing'],
    ['Curtain Wall Install', 'envelope', 'skin'],
    ['Building Dry-In', 'envelope', 'dryin'],
    ['MEP Rough-In L2', 'mep', 'mepRough'],
    ['Set RTUs', 'mep', 'mepEquip'],
    ['Metal Stud Framing L2', 'interiors', 'framing'],
    ['Hang & Tape GWB L2', 'interiors', 'drywall'],
    ['Paint L2', 'finishes', 'finishes'],
    ['ACT Ceilings', 'finishes', 'finishes'],
    ['Elevator Install', 'equipment', 'specialties'],
    ['Toilet Partitions & Accessories', 'equipment', 'specialties'],
    ['Asphalt Paving', 'sitework', 'paving'],
    ['TAB', 'closeout', 'cx'],
    ['Punch List', 'closeout', 'punch'],
    ['Substantial Completion', 'closeout', 'completion'],
    ['Final Completion', 'closeout', 'final'],
    ['Fire Marshal Final Inspection', 'permits', 'inspection'],
  ])('%s → %s (%s)', (name, category, stage) => {
    const c = classifyName(name)
    expect(c.category).toBe(category)
    expect(c.stage).toBe(stage)
    expect(c.confidence).toBeGreaterThan(0.4)
    expect(c.terms.length).toBeGreaterThan(0)
  })

  it('reads trade-specific submittals, deliveries and inspections with their trade', () => {
    expect(classifyName('Deliver Structural Steel')).toMatchObject({ modifier: 'procure', trade: 'structure', stageLabel: 'structure procurement' })
    expect(classifyName('RTU Submittals')).toMatchObject({ modifier: 'submittal', trade: 'mepEquip', category: 'procurement' })
    expect(classifyName('In-Wall Rough-In Inspection L2')).toMatchObject({ modifier: 'inspect', trade: 'mepRough', stage: 'mepRough', category: 'permits' })
    expect(classifyName('Grading Permit')).toMatchObject({ modifier: 'permit', trade: 'earthwork' })
  })

  it('explains itself with the matching terms and expansions', () => {
    const c = classifyName('F/R/P SOG')
    expect(c.terms).toContain('slab on grade')
    expect(c.terms).toContain('SOG = slab on grade')
    expect(c.source).toBe('name')
  })

  it('uses the WBS path when the name says nothing, at lower confidence', () => {
    const byName = classifyName('Hang Drywall')
    const byWbs = classifyName('Crew 2 work', 'Interiors > Drywall')
    expect(byWbs.stage).toBe('drywall')
    expect(byWbs.source).toBe('wbs')
    expect(byWbs.confidence).toBeLessThan(byName.confidence)
  })

  it('says when it does not recognise a name', () => {
    const c = classifyName('Widget alignment 7')
    expect(c.category).toBe('unknown')
    expect(c.stage).toBeNull()
    expect(c.confidence).toBe(0)
  })

  it('lowers confidence when two categories compete', () => {
    expect(classifyName('Steel paint').confidence).toBeLessThan(classifyName('Paint L2').confidence)
  })
})

/* ─── Sequencing graph ────────────────────────────────── */

describe('canonical sequencing', () => {
  it('is acyclic', () => {
    for (const a of Object.keys(STAGE_EDGES) as StageId[]) expect(stageDistance(a, a), a).toBeNull()
    for (const [a, bs] of Object.entries(STAGE_EDGES) as [StageId, StageId[]][]) for (const b of bs) expect(stageDistance(b, a), `${b}→${a}`).toBeNull()
  })
  it('orders the usual trades', () => {
    expect(stageDistance('mepRough', 'drywall')).toBe(1)
    expect(stageDistance('drywall', 'finishes')).toBe(1)
    expect(stageDistance('foundation', 'structure')).toBe(1)
    expect(stageDistance('structure', 'drywall')).toBe(2)
    expect(stageDistance('finishes', 'drywall')).toBeNull()
    expect(stageDistance('start', 'final')).not.toBeNull()
  })
})

/* ─── Suggestions ─────────────────────────────────────── */

/** Two-level fit-out with deliberate loose ends. */
function twoLevel() {
  const acts = [
    ms('A100', 'Notice to Proceed', 'start'),
    act('A110', 'Erect Structural Steel'),
    act('A200', 'MEP Rough-In L1'), act('A210', 'Hang Drywall L1'), act('A220', 'Paint L1'),
    act('A300', 'MEP Rough-In L2'), act('A310', 'Hang Drywall L2'), act('A320', 'Paint L2'),
    act('A400', 'Punch List'),
    ms('A900', 'Substantial Completion', 'finish'),
  ]
  const links = [
    link('A100', 'A110'), link('A110', 'A200'), link('A200', 'A210'), link('A210', 'A220'), link('A220', 'A400'),
    link('A110', 'A300'), /* A300 → A310 missing */ link('A310', 'A320'), /* A320 → ? missing */ link('A400', 'A900'),
  ]
  return { acts, links }
}

describe('suggestLogic', () => {
  it('finds the loose ends and suggests the usual trade sequence in the same location', () => {
    const { acts, links } = twoLevel()
    const r = suggestLogic(acts, links)
    expect(r.summary.projectStart?.code).toBe('A100')
    expect(r.summary.projectFinish?.code).toBe('A900')
    expect(r.summary.missingPredecessor).toBe(1) // A310
    expect(r.summary.missingSuccessor).toBe(2) // A300, A320
    expect(r.summary.looseEnds).toBe(3)
    const p = pairs(r)
    // One link closes two loose ends: rough-in L2 → drywall L2.
    expect(p).toContain('A300>A310')
    const fix = r.suggestions.find(x => x.id === 'id-A300>id-A310')!
    expect(fix.reason).toBe('Drywall usually follows MEP rough-in on Level 2.')
    expect(fix.fixes.sort()).toEqual(['id-A300', 'id-A310'])
    expect(fix.confidence).toBeGreaterThan(0.7)
    // Paint L2 needs a successor: the punch list (finishes → punch list).
    expect(p).toContain('A320>A400')
    expect(r.summary.suggested).toBe(3)
    expect(r.summary.unresolved).toBe(0)
    expect(acyclic(acts, withSuggestions(links, r))).toBe(true)
  })

  it('prefers the same location over another level', () => {
    const { acts, links } = twoLevel()
    const r = suggestLogic(acts, links)
    const toDrywall2 = r.suggestions.find(x => x.successor.code === 'A310')!
    expect(toDrywall2.predecessor.code).toBe('A300') // not MEP rough-in L1
  })

  it('suggests the same work at the previous location when the trade before it is not there', () => {
    const acts = [ms('S', 'NTP', 'start'), act('E1', 'Erect Steel Area A'), act('E2', 'Erect Steel Area B'), act('R', 'Roofing'), ms('F', 'Substantial Completion', 'finish')]
    const links = [link('S', 'E1'), link('E1', 'R'), link('E2', 'R'), link('R', 'F')]
    const r = suggestLogic(acts, links)
    const s = r.suggestions.find(x => x.successor.code === 'E2')!
    expect(s.predecessor.code).toBe('E1')
    expect(s.rule).toBe('next_location')
    expect(s.reason).toBe('Same work, next location: structure in Area B usually follows Area A.')
  })

  it('puts deliveries before installation of the same trade', () => {
    const acts = [ms('S', 'NTP', 'start'), act('D', 'Deliver Structural Steel'), act('E', 'Erect Structural Steel'), act('R', 'Roofing'), ms('F', 'Substantial Completion', 'finish')]
    const links = [link('S', 'D'), link('E', 'R'), link('R', 'F')]
    const r = suggestLogic(acts, links)
    const s = r.suggestions.find(x => x.predecessor.code === 'D')!
    expect(s.successor.code).toBe('E')
    expect(s.rule).toBe('delivery_before_install')
    expect(s.reason).toBe('Structure work usually starts once its materials are delivered.')
    expect(s.fixes.sort()).toEqual(['id-D', 'id-E'])
  })

  it('places an inspection between the work and what covers it', () => {
    const acts = [ms('S', 'NTP', 'start'), act('M', 'MEP Rough-In L2'), act('I', 'Rough-In Inspection L2'), act('D', 'Hang Drywall L2'), ms('F', 'Substantial Completion', 'finish')]
    const links = [link('S', 'M'), link('D', 'F')]
    const r = suggestLogic(acts, links)
    expect(pairs(r)).toEqual(expect.arrayContaining(['M>I', 'I>D']))
    expect(acyclic(acts, withSuggestions(links, r))).toBe(true)
  })

  it('never suggests a link that would create a loop', () => {
    // Drywall L2 has no successor and the only "usual" successor (Paint L2) already leads back to it.
    const acts = [ms('S', 'NTP', 'start'), act('P', 'Paint L2'), act('D', 'Hang Drywall L2'), ms('F', 'Substantial Completion', 'finish')]
    const links = [link('S', 'P'), link('P', 'D'), link('P', 'F')]
    const r = suggestLogic(acts, links)
    expect(pairs(r)).not.toContain('D>P')
    expect(acyclic(acts, withSuggestions(links, r))).toBe(true)
    // Falls back to the project finish, which is safe.
    expect(r.suggestions.find(x => x.predecessor.code === 'D' && x.action === 'add_link')?.successor.code).toBe('F')
  })

  it('stays acyclic when its own suggestions interact', () => {
    // Every activity is a loose end on one side; accepting suggestions one at a time must not close a loop.
    const names = ['Excavation', 'Footings', 'Slab on Grade', 'Erect Steel', 'Roofing', 'MEP Rough-In', 'Hang Drywall', 'Paint', 'Punch List']
    const acts = [ms('S', 'NTP', 'start'), ...names.map((n, i) => act(`X${i}`, n)), ms('F', 'Substantial Completion', 'finish')]
    // Backwards links from late trades to early ones, so naive suggestions would loop.
    const links = [link('S', 'X8'), link('X8', 'X0'), link('X7', 'X1'), link('X6', 'X2'), link('X0', 'F')]
    const r = suggestLogic(acts, links)
    expect(pairs(r).length).toBeGreaterThan(3)
    expect(acyclic(acts, withSuggestions(links, r))).toBe(true)
  })

  it('skips links already implied through the network (transitive reduction)', () => {
    // Drywall L2 → Paint L2 would be the usual link, but Drywall already reaches Paint through the ceiling grid.
    const acts = [ms('S', 'NTP', 'start'), act('D', 'Hang Drywall L2'), act('C', 'Ceiling Grid L2'), act('T', 'Paint L2', {}), ms('F', 'Substantial Completion', 'finish')]
    const links = [link('S', 'D'), link('D', 'C'), link('C', 'F'), link('T', 'F'), link('C', 'T', 'SS')]
    const r = suggestLogic(acts, links)
    // Paint has a predecessor (SS from ceilings), so it is no loose end, and D→T is implied by D→C→T.
    expect(r.summary.missingPredecessor).toBe(0)
    expect(pairs(r)).not.toContain('D>T')
  })

  it('flags work tied only to the finish milestone and finds it a technical successor', () => {
    const xer = parseXER(readFileSync(path.join(__dirname, '../parsers/__fixtures__/sample.xer'), 'utf8'), 's1')
    const r = suggestLogic(xer.activities, xer.relationships)
    expect(r.summary.projectStart?.code).toBe('A1000')
    expect(r.summary.projectFinish?.code).toBe('A1070')
    expect(r.summary.looseEnds).toBe(0)
    // Cure Footings and Erect Structural Steel lead only to Substantial Completion; only the cure has a
    // later trade in this file to feed.
    expect(r.summary.completionOnly).toBe(2)
    expect(r.suggestions.filter(x => x.kind === 'completion_only')).toHaveLength(1)
    const s = r.suggestions.find(x => x.kind === 'completion_only')!
    expect(s.predecessor.code).toBe('A1060') // Cure Footings
    // Slab on grade (which already leads to the steel), so the cure also drives the steel without a second link.
    expect(s.successor.code).toBe('A1040')
    expect(s.reason).toBe('Slab on grade usually follows concrete curing.')
    expect(pairs(r)).not.toContain('A1060>A1050')
    expect(acyclic(xer.activities, withSuggestions(xer.relationships, r))).toBe(true)
  })

  it('ignores completed activities, level-of-effort and summary rows', () => {
    const acts = [ms('S', 'NTP', 'start'), act('M', 'Mobilization', { status: 'complete' }), act('L', 'General Conditions', { activityType: 'loe' }), act('E', 'Mass Excavation'), ms('F', 'Substantial Completion', 'finish')]
    const links = [link('S', 'E'), link('E', 'F')]
    const r = suggestLogic(acts, links)
    expect(r.summary.looseEnds).toBe(0)
    expect(r.summary.activities).toBe(4)
    expect(r.profiles['id-L']).toBeUndefined()
  })

  it('reports loose ends it cannot fix', () => {
    const acts = [act('W', 'Widget alignment 7'), act('Q', 'Gizmo calibration')]
    const r = suggestLogic(acts, [])
    expect(r.summary.looseEnds).toBe(2)
    expect(r.summary.suggested).toBe(0)
    expect(r.unresolved.map(u => `${u.code}:${u.missing}`).sort()).toEqual(['Q:predecessor', 'Q:successor', 'W:predecessor', 'W:successor'])
  })

  it('borrows the stage of neighbouring activities for names it cannot read', () => {
    const acts = [ms('S', 'NTP', 'start'), act('M', 'MEP Rough-In L2'), act('X', 'Crew 4 work L2'), ms('F', 'Substantial Completion', 'finish')]
    const r = suggestLogic(acts, [link('S', 'M'), link('M', 'X'), link('X', 'F')])
    expect(r.profiles['id-X']).toMatchObject({ source: 'neighbours', stageLabel: 'MEP rough-in' })
    expect(r.profiles['id-X'].confidence).toBeLessThanOrEqual(0.4)
  })

  it('flags links that run against the usual order', () => {
    const acts = [ms('S', 'NTP', 'start'), act('P', 'Paint L2'), act('D', 'Hang Drywall L2'), ms('F', 'Substantial Completion', 'finish')]
    const r = suggestLogic(acts, [link('S', 'P'), link('P', 'D'), link('D', 'F')])
    const s = r.suggestions.find(x => x.kind === 'out_of_sequence')!
    expect(s.action).toBe('review_link')
    expect(`${s.predecessor.code}>${s.successor.code}`).toBe('P>D')
    expect(s.reason).toBe('Drywall usually comes before finishes on Level 2; check this link\'s direction.')
    expect(r.summary.outOfSequence).toBe(1)
  })

  it('lists finish-to-start links already implied by others', () => {
    const links = [link('A', 'B'), link('B', 'C'), link('A', 'C'), link('A', 'D', 'SS'), link('D', 'C')]
    const ref = (id: string) => ({ id, code: id.replace('id-', ''), name: id })
    const out = redundantLinks(links, ref)
    expect(out.map(o => `${o.predecessor.code}>${o.successor.code}`)).toEqual(['A>C'])
    expect(out[0].reason).toContain('through B')
    // Paths through start-to-start links do not imply finish-to-start.
    expect(redundantLinks([link('A', 'B', 'SS'), link('B', 'C'), link('A', 'C')], ref)).toEqual([])
  })

  it('gives reasons about kinds of work, not activity names', () => {
    const { acts, links } = twoLevel()
    for (const s of suggestLogic(acts, links).suggestions.filter(x => x.action === 'add_link')) {
      for (const a of acts) expect(s.reason.includes(a.name), s.reason).toBe(false)
    }
  })

  it('is deterministic and scales to a large repetitive schedule', () => {
    const acts: LogicActivity[] = [ms('S', 'NTP', 'start')]
    const links: LogicLink[] = []
    const trades = ['Metal Stud Framing', 'MEP Rough-In', 'Hang Drywall', 'Paint', 'Install Flooring']
    for (let lv = 1; lv <= 40; lv++) trades.forEach((t, i) => {
      acts.push(act(`L${lv}-${i}`, `${t} Level ${lv}`))
      if (i > 0 && (lv + i) % 3) links.push(link(`L${lv}-${i - 1}`, `L${lv}-${i}`))
    })
    acts.push(ms('F', 'Substantial Completion', 'finish'))
    const t0 = Date.now()
    const a = suggestLogic(acts, links)
    expect(Date.now() - t0).toBeLessThan(5000)
    const b = suggestLogic(acts, links)
    expect(pairs(a)).toEqual(pairs(b))
    expect(acyclic(acts, withSuggestions(links, a))).toBe(true)
    expect(a.summary.suggested).toBeGreaterThan(a.summary.looseEnds * 0.8)
  })
})

describe('CSV', () => {
  it('exports every suggestion with a header and neutralises formulas', () => {
    const { acts, links } = twoLevel()
    const r = suggestLogic(acts, links)
    const csv = suggestionsCsv(r.suggestions)
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toMatch(/^Priority,Issue,Action,Predecessor ID/)
    expect(lines).toHaveLength(r.suggestions.length + 1)
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('a,b')).toBe('"a,b"')
  })
})
