// Construction abbreviations as schedulers write them in activity names (P6 / MS Project exports),
// and name normalisation: lower case, punctuation folded, abbreviations expanded. Deterministic and
// offline; every expansion is reported so the "why" of a classification can show it.

export interface Abbreviation {
  /** Lower-case token as written, e.g. "sog", "f/r/p", "e&s" */
  abbr: string
  /** Expansion in plain words */
  full: string
  /** Expand only when the whole name is this token (e.g. "SC" alone is Substantial Completion) */
  wholeNameOnly?: boolean
}

const a = (abbr: string, full: string, wholeNameOnly = false): Abbreviation => ({ abbr, full, ...(wholeNameOnly ? { wholeNameOnly } : {}) })

/** Realistic construction abbreviations. Ambiguous ones (SF, FS, CO, AC, PC, SW) are left out on purpose; FRP and SUB expand only as a whole name. */
export const ABBREVIATIONS: readonly Abbreviation[] = [
  // Milestones, general requirements
  a('ntp', 'notice to proceed'), a('sc', 'substantial completion', true), a('tco', 'temporary certificate of occupancy'),
  a('mob', 'mobilization'), a('demob', 'demobilization'), a('precon', 'preconstruction'), a('prelim', 'preliminary'),
  a('temp', 'temporary'), a('perm', 'permanent'), a('gc', 'general contractor'), a('const', 'construction'),
  a('ahj', 'authority having jurisdiction'), a('insp', 'inspection'), a('appr', 'approval'), a('rev', 'review'),
  a('o&m', 'operations and maintenance'), a('trng', 'training'), a('swppp', 'stormwater pollution prevention plan'),
  // Procurement
  a('submtl', 'submittal'), a('sub', 'submittal', true), a('shop dwgs', 'shop drawings'), a('dwgs', 'drawings'), a('dwg', 'drawing'),
  a('po', 'purchase order'), a('fab', 'fabrication'), a('fabr', 'fabrication'), a('del', 'delivery'), a('dlvr', 'deliver'),
  a('proc', 'procurement'), a('procure', 'procurement'),
  // Sitework
  a('demo', 'demolition'), a('hazmat', 'hazardous materials'), a('acm', 'asbestos containing material'), a('abate', 'abatement'),
  a('exc', 'excavation'), a('excav', 'excavation'), a('bkfl', 'backfill'), a('b/f', 'backfill'), a('grd', 'grading'),
  a('u/g', 'underground'), a('ug', 'underground'), a('util', 'utilities'), a('utils', 'utilities'), a('san', 'sanitary'),
  a('stm', 'storm'), a('wtr', 'water'), a('mh', 'manhole'), a('cb', 'catch basin'), a('fdc', 'fire department connection'),
  a('e&s', 'erosion and sediment control'), a('bmp', 'best management practices'), a('row', 'right of way'),
  a('mot', 'maintenance of traffic'), a('hma', 'hot mix asphalt'), a('pvg', 'paving'), a('pvmt', 'pavement'),
  a('lndscp', 'landscaping'), a('irr', 'irrigation'), a('crb', 'curb'),
  // Concrete & foundations
  a('conc', 'concrete'), a('cip', 'cast in place'), a('pt', 'post tensioned'), a('f/r/p', 'form rebar pour'), a('frp', 'form rebar pour', true),
  a('ftg', 'footing'), a('ftgs', 'footings'), a('fdn', 'foundation'), a('fdns', 'foundations'), a('fnd', 'foundation'),
  a('sog', 'slab on grade'), a('s.o.g', 'slab on grade'), a('somd', 'slab on metal deck'), a('gb', 'grade beam'),
  a('emb', 'embeds'), a('reinf', 'reinforcing'), a('cmu', 'concrete masonry unit'), a('acip', 'auger cast piles'),
  // Structure
  a('stl', 'steel'), a('str', 'structural'), a('struct', 'structural'), a('strl', 'structural'), a('mtl', 'metal'),
  a('dk', 'deck'), a('md', 'metal deck'), a('jst', 'joist'), a('jsts', 'joists'), a('col', 'column'), a('cols', 'columns'),
  a('bm', 'beam'), a('erec', 'erection'), a('frmg', 'framing'), a('frm', 'framing'), a('clt', 'cross laminated timber'),
  // Envelope
  a('eifs', 'exterior insulation finish system'), a('cw', 'curtain wall'), a('wdw', 'window'), a('wdws', 'windows'), a('win', 'window'),
  a('tpo', 'thermoplastic polyolefin roofing'), a('epdm', 'epdm roofing'), a('bur', 'built up roofing'), a('wp', 'waterproofing'),
  a('avb', 'air vapor barrier'), a('vb', 'vapor barrier'), a('insul', 'insulation'), a('ext', 'exterior'), a('int', 'interior'),
  // MEP
  a('mep', 'mechanical electrical plumbing'), a('mepf', 'mechanical electrical plumbing fire protection'), a('hvac', 'heating ventilation air conditioning'),
  a('mech', 'mechanical'), a('elec', 'electrical'), a('plbg', 'plumbing'), a('plmb', 'plumbing'), a('plumb', 'plumbing'),
  a('fp', 'fire protection'), a('fa', 'fire alarm'), a('spk', 'sprinkler'), a('sprk', 'sprinkler'), a('lv', 'low voltage'),
  a('bms', 'building management system'), a('bas', 'building automation system'), a('o/h', 'overhead'), a('oh', 'overhead'),
  a('rtu', 'rooftop unit'), a('rtus', 'rooftop units'), a('ahu', 'air handling unit'), a('ahus', 'air handling units'),
  a('vav', 'variable air volume box'), a('fcu', 'fan coil unit'), a('ef', 'exhaust fan'), a('doas', 'dedicated outdoor air system'),
  a('vrf', 'variable refrigerant flow'), a('swgr', 'switchgear'), a('xfmr', 'transformer'), a('xfmrs', 'transformers'),
  a('msb', 'main switchboard'), a('gen', 'generator'), a('ats', 'automatic transfer switch'), a('ups', 'uninterruptible power supply'),
  a('pnl', 'panel'), a('pnls', 'panels'), a('ltg', 'lighting'), a('fxt', 'fixtures'), a('fxtrs', 'fixtures'), a('pwr', 'power'),
  // Interiors & finishes
  a('gwb', 'gypsum wall board'), a('gyp', 'gypsum'), a('dw', 'drywall'), a('act', 'acoustical ceiling tile'), a('clg', 'ceiling'),
  a('vct', 'vinyl composition tile'), a('lvt', 'luxury vinyl tile'), a('cpt', 'carpet'), a('pnt', 'paint'), a('hm', 'hollow metal'),
  a('dr', 'door'), a('drs', 'doors'), a('hdw', 'hardware'), a('hdwr', 'hardware'), a('mlwk', 'millwork'), a('cswk', 'casework'),
  a('ff&e', 'furniture fixtures and equipment'), a('ffe', 'furniture fixtures and equipment'), a('elev', 'elevator'), a('elevs', 'elevators'),
  a('esc', 'escalator'), a('tptn', 'toilet partitions'),
  // Commissioning & closeout
  a('cx', 'commissioning'), a('tab', 'testing adjusting balancing'), a('t&b', 'testing and balancing'), a('fpt', 'functional performance test'),
  a('ist', 'integrated systems test'), a('punchlist', 'punch list'),
  // Install verbs
  a('inst', 'install'), a('instl', 'install'), a('prep', 'preparation'), a('compl', 'complete'),
]

const BY_ABBR = new Map(ABBREVIATIONS.map(x => [x.abbr, x]))
// Multi-word keys ("shop dwgs") are matched before single tokens.
const MULTI = ABBREVIATIONS.filter(x => x.abbr.includes(' '))

export interface NormalizedName {
  /** Lower-case text with abbreviations expanded and punctuation folded to spaces */
  text: string
  /** Words of `text` */
  tokens: string[]
  /** Abbreviations that were expanded, in order */
  expansions: { abbr: string; full: string }[]
}

/** Tokens: words, keeping "/", "&" and "." inside short tokens (F/R/P, U/G, E&S, FF&E, S.O.G.) */
const TOKEN_RE = /[a-z0-9]+(?:[/&.][a-z0-9]+)*/g

/** Lower-case and fold dashes / underscores; "rough-in" stays one phrase as "rough in". */
export function foldText(s: string): string {
  return (s ?? '').toLowerCase().replace(/[_–—]+/g, ' ').replace(/(\w)-(\w)/g, '$1 $2').replace(/\s+/g, ' ').trim()
}

/**
 * Normalise an activity name: fold case and punctuation, expand construction abbreviations
 * ("Install RTUs - L2" → "install rooftop units l2"). Unknown tokens are kept as written.
 */
export function normalizeName(name: string): NormalizedName {
  let s = foldText(name)
  const expansions: NormalizedName['expansions'] = []
  for (const m of MULTI) {
    const re = new RegExp(`\\b${m.abbr.replace(/[.*+?^${}()|[\]\\/&]/g, '\\$&')}\\b`, 'g')
    if (re.test(s)) { s = s.replace(re, m.full); expansions.push({ abbr: m.abbr, full: m.full }) }
  }
  const raw = s.match(TOKEN_RE) ?? []
  const whole = raw.length === 1
  const out: string[] = []
  for (const t0 of raw) {
    const t = t0.replace(/\.$/, '')
    const hit = BY_ABBR.get(t) ?? BY_ABBR.get(t.replace(/\./g, ''))
    if (hit && (!hit.wholeNameOnly || whole) && hit.full !== t) {
      out.push(...hit.full.split(' '))
      expansions.push({ abbr: t, full: hit.full })
    } else if (/[/&]/.test(t)) {
      // Unknown compound ("vct/carpet", "hang/tape"): expand its parts one by one.
      for (const part of t.split(/[/&]/).filter(Boolean)) {
        const h = BY_ABBR.get(part)
        if (h && !h.wholeNameOnly && h.full !== part) { out.push(...h.full.split(' ')); expansions.push({ abbr: part, full: h.full }) } else out.push(part)
      }
    } else {
      out.push(t.replace(/\./g, ''))
    }
  }
  return { text: out.join(' '), tokens: out, expansions }
}
