// Semantic normalization across firms: maps heterogeneous activity names and calendar labels
// (as seen in P6 / MS Project exports) onto Planora's canonical categories, phases and work weeks.

import type { CanonicalCategory, Classified, Phase, Weekday } from '@/lib/planning/types'

/* ─── Phases & labels ──────────────────────────────────── */

const PHASE: Record<CanonicalCategory, Phase> = {
  ntp: 'preconstruction',
  design_sd: 'design',
  design_dd: 'design',
  design_cd: 'design',
  design_review: 'design',
  permit_site: 'permitting',
  permit_building: 'permitting',
  permit_other: 'permitting',
  submittals: 'procurement',
  procurement: 'procurement',
  mobilization: 'sitework',
  demolition: 'sitework',
  abatement: 'sitework',
  earthwork: 'sitework',
  utilities_site: 'sitework',
  deep_foundations: 'sitework',
  foundations: 'structure',
  slab_on_grade: 'structure',
  structure_steel: 'structure',
  structure_concrete: 'structure',
  structure_wood: 'structure',
  roofing: 'envelope',
  exterior_skin: 'envelope',
  windows_curtainwall: 'envelope',
  dry_in: 'envelope',
  mep_rough: 'mep',
  electrical_service: 'mep',
  mechanical_equipment: 'mep',
  elevators: 'mep',
  fire_protection: 'mep',
  low_voltage: 'mep',
  framing_drywall: 'interiors',
  finishes: 'interiors',
  specialties: 'interiors',
  paving_landscape: 'sitework',
  commissioning: 'commissioning',
  inspections: 'commissioning',
  punchlist: 'closeout',
  substantial_completion: 'closeout',
  closeout: 'closeout',
  final_completion: 'closeout',
  row_utilities: 'sitework',
  traffic_control: 'sitework',
  in_water_work: 'sitework',
  substructure: 'structure',
  superstructure: 'structure',
  deck: 'structure',
  roadway: 'sitework',
  drainage: 'sitework',
  pipeline: 'sitework',
  process_structures: 'structure',
  process_equipment: 'mep',
  power_equipment: 'mep',
  controls_scada: 'mep',
  track_systems: 'mep',
  conductors: 'mep',
  startup_testing: 'commissioning',
  cutover: 'commissioning',
  contingency: 'closeout',
  other: 'preconstruction',
}

const LABEL: Record<CanonicalCategory, string> = {
  ntp: 'Notice to proceed',
  design_sd: 'Schematic design',
  design_dd: 'Design development',
  design_cd: 'Construction documents',
  design_review: 'Design review',
  permit_site: 'Site / grading permits',
  permit_building: 'Building permit',
  permit_other: 'Other permits & approvals',
  submittals: 'Submittals',
  procurement: 'Procurement / fabrication',
  mobilization: 'Mobilization',
  demolition: 'Demolition',
  abatement: 'Abatement',
  earthwork: 'Earthwork',
  utilities_site: 'Site utilities',
  deep_foundations: 'Deep foundations',
  foundations: 'Foundations',
  slab_on_grade: 'Slab on grade',
  structure_steel: 'Structural steel',
  structure_concrete: 'Concrete structure',
  structure_wood: 'Wood framing',
  roofing: 'Roofing',
  exterior_skin: 'Exterior skin',
  windows_curtainwall: 'Windows & curtain wall',
  dry_in: 'Dry-in',
  mep_rough: 'MEP rough-in',
  electrical_service: 'Permanent power',
  mechanical_equipment: 'Mechanical equipment',
  elevators: 'Elevators',
  fire_protection: 'Fire protection',
  low_voltage: 'Low voltage',
  framing_drywall: 'Framing & drywall',
  finishes: 'Finishes',
  specialties: 'Specialties',
  paving_landscape: 'Paving & landscape',
  commissioning: 'Commissioning',
  inspections: 'Inspections',
  punchlist: 'Punch list',
  substantial_completion: 'Substantial completion',
  closeout: 'Closeout',
  final_completion: 'Final completion',
  row_utilities: 'Right-of-way & utility relocation',
  traffic_control: 'Traffic control / staging',
  in_water_work: 'In-water work & cofferdams',
  substructure: 'Substructure',
  superstructure: 'Superstructure',
  deck: 'Bridge deck',
  roadway: 'Roadway & paving',
  drainage: 'Drainage',
  pipeline: 'Pipelines & yard piping',
  process_structures: 'Process structures & tanks',
  process_equipment: 'Process equipment',
  power_equipment: 'Power equipment',
  controls_scada: 'Controls, instrumentation & SCADA',
  track_systems: 'Track & rail systems',
  conductors: 'Bus work & conductors',
  startup_testing: 'Startup & testing',
  cutover: 'Cutover, tie-ins & outages',
  contingency: 'Contingency',
  other: 'Other',
}

export function phaseOf(c: CanonicalCategory): Phase {
  return PHASE[c]
}

export function categoryLabel(c: CanonicalCategory): string {
  return LABEL[c]
}

/* ─── Activity classification rules (ordered: first match wins) ─── */

export interface TaxonomyRule {
  id: string
  re: RegExp
  category: CanonicalCategory
  confidence: number
}

const r = (id: string, re: RegExp, category: CanonicalCategory, confidence = 0.85): TaxonomyRule => ({ id, re, category, confidence })

export const TAXONOMY_RULES: TaxonomyRule[] = [
  // Milestones & completion
  r('ntp', /\bntp\b|notice\s+to\s+proceed|\bnotice\s+of\s+award\b/, 'ntp', 0.95),
  r('final-completion', /\bfinal\s+(completion|acceptance)\b|\bproject\s+complete\b|\bfc\s+milestone\b/, 'final_completion', 0.95),
  r('substantial-completion', /\bsub(stantial|st)?\.?\s*comp(letion|l|\.)?\b|^\s*sc\s*$|\bsc\s+milestone\b|\btco\b|temp(orary)?\s+cert(ificate)?\s+of\s+occ|\bc\s*of\s*o\b|cert(ificate)?\s+of\s+occ(upancy)?|\bbeneficial\s+occupancy\b/, 'substantial_completion', 0.85),
  r('demob', /\bdemob(ilization|ilize)?\b/, 'closeout', 0.75),
  r('closeout', /close[\s-]?out|\bo\s*&\s*m\b|as[\s-]?builts?|warrant(y|ies)|attic\s+stock|owner\s+training|record\s+drawings/, 'closeout', 0.85),
  r('punch', /punch/, 'punchlist', 0.95),
  r('contingency', /contingency|weather\s+(days|allowance)|schedule\s+(reserve|buffer)|\bbuffer\b/, 'contingency', 0.8),

  // Design
  r('design-review', /design\s+review|\b(sd|dd|cd)\s+(owner\s+|agency\s+|client\s+)?review\b|\b(35|50|65|90|95)\s*%\s*(design\s+)?(review|submittal|submission)|\bcharrette\b|\bvalue\s+engineering\b|\bve\s+session\b/, 'design_review', 0.85),
  r('design-cd', /construction\s+doc(ument)?s?|\bcds?\b\s*(\d{2,3}\s*%)?|\b100\s*%\s*(cds?|design)\b|\bbid\s+(docs|documents|set)\b|\bifc\s+(docs|set|drawings)\b/, 'design_cd', 0.85),
  r('design-dd', /design\s+dev(elopment)?|\bdds?\b/, 'design_dd', 0.85),
  r('design-sd', /schematic(\s+design)?|\bsds?\b|\bconcept(ual)?\s+design\b/, 'design_sd', 0.85),

  // Permits
  r('fire-marshal-review', /fire\s+marshal\s+(plan\s+)?(review|approval|submittal)/, 'permit_other', 0.8),
  r('permit-site', /(grading|site|civil|land[\s-]?disturb(ance)?|excavation|stormwater|erosion|e\s*&\s*s|sitework|demo(lition)?)\s+permit|\bswppp\b|\bnpdes\b|\bnoi\b|\bsite\s+plan\s+approval\b/, 'permit_site', 0.85),
  r('permit-building', /(bldg|building|construction|foundation|structural|core\s*(&|and)\s*shell|shell|ti)\s+permit|permit\s*[-–:]\s*(bldg|building)|\bplan\s+check\b|\bplan\s+review\b|\bdob\b\s+(approval|permit|filing)/, 'permit_building', 0.85),
  r('permit-other', /\bpermits?\b|\bhcai\b|\boshpd\b|\bdsa\b|\bfaa\b|\b7460\b|\bnepa\b|\bshpo\b|\bsection\s+106\b|\bceqa\b|\bsepa\b|\bseqra\b|\bentitlements?\b|\bzoning\b|\bvariance\b|\bcertificate\s+of\s+need\b|\bcopn\b/, 'permit_other', 0.75),

  // Civil / infrastructure (specific terms, before the generic building rules)
  r('row-utilities', /right[\s-]of[\s-]way|\brow\s+(acquisition|clearance|certification)|utility\s+relocat|railroad\s+(agreement|force\s+account|flagging\s+agreement)/, 'row_utilities', 0.85),
  r('traffic-control', /\bmot\b|maintenance\s+of\s+traffic|traffic\s+(control|switch|shift|staging)|\bdetours?\b|lane\s+closures?|\bstage\s+\d+\s+traffic\b|temporary\s+(barrier|crossover)/, 'traffic_control', 0.85),
  r('in-water', /cofferdams?|in[\s-]water|\btremie\b|\bseal\s+course\b|fish\s+window|work\s+window/, 'in_water_work', 0.85),
  r('substructure', /abutments?|pier\s+(caps?|columns?|stems?|footings?)|\bbents?\b|wing\s*walls?|retaining\s+walls?|\bmse\s+walls?/, 'substructure', 0.85),
  r('superstructure', /girders?|\bbearings?\b|diaphragms?|beam\s+(set|erection|placement)|bulb[\s-]?t|box\s+beams?|\bstringers?\b/, 'superstructure', 0.85),
  r('deck', /bridge\s+deck|deck\s+(form(s|ing)?|rebar|pour|overlay|cure|placement)|barrier\s+rails?|parapets?|expansion\s+joints?|approach\s+slabs?/, 'deck', 0.85),
  r('roadway', /(aggregate\s+)?base\s+course|\bhma\b|\bpccp?\b|mill(ing)?\s*(&|and)\s*overlay|\bsubbase\b|roadway|travel\s+lanes?|\bmainline\b|\bshoulders?\b|guard\s*rail/, 'roadway', 0.8),
  r('drainage', /culverts?|\binlets?\b|catch\s+basins?|head\s*walls?|underdrains?|\bswales?\b|storm\s+drainage/, 'drainage', 0.8),
  r('pipeline', /transmission\s+main|yard\s+piping|force\s+main|pipe\s*line|\bhdd\b|directional\s+drill|jack(ing)?\s*(&|and)\s*bore|micro[\s-]?tunnel|tunnel(l?ing)?\b|process\s+piping|pipe\s+(spool|rack\s+piping)/, 'pipeline', 0.85),
  r('process-structures', /clarifiers?|digesters?|aeration|\bbasins?\b|wet\s*wells?|reservoirs?|\b(concrete|storage|process)\s+tanks?|leak(age)?\s+test|headworks|filter\s+(building|gallery)/, 'process_structures', 0.85),
  r('process-equipment', /(?<!fire\s)(?<!heat\s)\bpumps?\b|\bvalves?\b|\bblowers?\b|\bscreens?\b|(filtration|treatment|\buf|\bro|\bmbr)\s+membranes?|process\s+(mechanical|equipment)|\bvessels?\b|compressors?|heat\s+exchangers?|\bskids?\b|\bset\s+equipment\b/, 'process_equipment', 0.8),
  r('controls-scada', /\bscada\b|\bplcs?\b|\bi\s*&\s*c\b|instrumentation|\bdcs\b|relay\s+(panels?|testing|settings)|protection\s*(&|and)\s*control|train\s+control|\bcbtc\b|\bptc\b|signal(s|ing)?\s+(system|install|cutover|equipment)|wayside/, 'controls_scada', 0.85),
  r('track', /\btrack(work)?\b|\bballast\b|\bcross\s*ties\b|\bties\b|rail\s+(install|welding|destress)|special\s+trackwork|turnouts?|\bocs\b|catenary|third\s+rail/, 'track_systems', 0.85),
  r('power-equipment', /traction\s+power|\btpss\b|circuit\s+breakers?|power\s+transformers?|\bgsu\b|\bgis\b|capacitor\s+banks?|reactors?\b/, 'power_equipment', 0.85),
  r('conductors', /stringing|\bconductors?\b|bus\s*work|\bopgw\b|insulators?|dead[\s-]?ends?/, 'conductors', 0.8),
  r('startup-testing', /performance\s+test|acceptance\s+test|\bsat\b|\bfat\b|pre[\s-]?revenue|trial\s+running|\bseeding\b|wet\s+test|process\s+start[\s-]?up|pre[\s-]?commission/, 'startup_testing', 0.85),
  r('cutover', /cut[\s-]?over|tie[\s-]?ins?\b|\bshut\s*downs?\b|\boutages?\b|track\s+possession|weekend\s+(closure|outage)/, 'cutover', 0.85),

  // Commissioning & inspections
  r('cx', /\bcx\b|commission|\btab\b|test(ing)?\s*(&|and)\s*balanc|\bfpts?\b|functional\s+(performance\s+)?test|\bist\b|integrated\s+systems?\s+test|start[\s-]?up|pre[\s-]?functional|\bl[1-5]\s+(test|cx)|load\s+bank/, 'commissioning', 0.85),
  r('inspection', /inspection|\binsp\b|fire\s+marshal|\bahj\b|final\s+walk|life\s+safety\s+(test|walk)|\bsign[\s-]?off\b|\bhealth\s+dept\b/, 'inspections', 0.8),

  // Procurement
  r('submittal', /submittal|shop\s+dwgs?|shop\s+drawings?|\bsubmit\b|product\s+data/, 'submittals', 0.85),
  r('procure', /procure|fabricat|\bfab\b|deliver(y|ies)?\b|\blead\s+time\b|\bbuy\s?out\b|\bpurchase\b|\bp\.?o\.?\b|\brelease\s+(for|to)\s+(fab|order)|\bmill\s+(order|rolling)\b|\border\b|\bmanufactur/, 'procurement', 0.8),

  r('approval-generic', /\bapprovals?\b|\bauthority\s+review\b/, 'permit_other', 0.55),

  // Sitework
  r('mob', /\bmob(ilization|ilize|e)?\b|site\s+set[\s-]?up|\btrailers?\b|temp(orary)?\s+(facilities|fence|fencing|utilities)|\bconstruction\s+entrance\b/, 'mobilization', 0.85),
  r('abatement', /abate|asbestos|haz[\s-]?mat|lead[\s-]?(based\s+)?paint|\bacm\b(?!\s+panel)|remediat|\bmold\b/, 'abatement', 0.9),
  r('demo', /\bdemo(lition|lish|lishing|s)?\b|\bstrip[\s-]?out\b|\bgut\b|\bsawcut\b/, 'demolition', 0.85),
  r('dry-in', /dry[\s-]?in|water[\s-]?tight|weather[\s-]?tight|building\s+enclos(ed|ure\s+complete)|\benclosed\b/, 'dry_in', 0.9),
  r('pile-cap', /pile\s+caps?|elevator\s+pits?/, 'foundations', 0.85),
  r('earthwork', /excavat|\bmass\s*(ex|exc|x)\b|grading|cut\s*(&|and|\/)\s*fill|earth\s*work|back\s*fill|compaction|sub[\s-]?grade|site\s+clear|clear(ing)?\s*(&|and)\s*grub|shoring|sheet\s*pil|soil\s+nail|dewater|over[\s-]?ex|\bundercut\b|\btopsoil\b|\bstrip\s+site\b|erosion\s+control|silt\s+fence|\bbmps?\b/, 'earthwork', 0.85),
  r('deep-foundations', /\bpil(e|es|ing)\b|caisson|drilled\s+(pier|shaft)s?|aggregate\s+piers?|geopier|rammed\s+aggregate|auger[\s-]?cast|\bacip\b|micro[\s-]?piles?|\bh[\s-]?piles?\b|\bdrilled\s+foundations?\b/, 'deep_foundations', 0.9),
  r('foundations', /footings?|foundations?|\bf\s*\/\s*r\s*\/\s*p\b|form\s*(,|\/|&)?\s*rebar|\bfrp\b|grade\s+beams?|spread\s+ftg|stem\s+walls?|\bfdn\b|\bftg\b|\bmat\s+(foundation|slab)\b|\bfnd\b|\bpiers?\b/, 'foundations', 0.85),
  r('sog', /\bsog\b|slab[\s-]on[\s-]grade|\bs\.o\.g\.?|ground\s+floor\s+slab|under[\s-]?slab|vapor\s+(barrier|retarder)|\bslab\s+prep\b/, 'slab_on_grade', 0.9),

  // MEP equipment & service (before generic structure/utility words)
  r('perm-power', /perm(anent)?\.?\s+power|energiz|switchgear|service\s+entrance|utility\s+power|\btransformers?\b|\bxfmrs?\b|\bmsb\b|main\s+switchboard|power\s+on\b|\bgenerators?\b|\bgensets?\b|\bups\b|\bats\b|\bprimary\s+(service|feed)/, 'electrical_service', 0.85),
  r('mech-equip', /\bahus?\b|\brtus?\b|chillers?|boilers?|cooling\s+towers?|\bcrahs?\b|\bcracs?\b|mech(anical)?\.?\s+equip|set\s+(mech|hvac|equip)|heat\s+pumps?|\bvrf\b|\bdoas\b|\bmaus?\b|exhaust\s+fans?|air\s+handl/, 'mechanical_equipment', 0.85),
  r('fire-protection', /sprinkler|fire\s+protection|fire\s+suppress|standpipe|fire\s+pump|\bfp\b|fire\s+alarm|\bfa\b|\bfsp\b|clean\s+agent|pre[\s-]?action|\bfacp\b/, 'fire_protection', 0.85),
  r('site-utilities', /site\s+util|storm\s*(drain|sewer|water\s+(line|pipe))|sanitary|water\s+(main|line|service)|\bsewer\b|fire\s+line|under\s*ground\s+util|\bu\s*\/\s*g\b|duct\s*banks?|\butility\b|\butilities\b|\bwet\s+utilities\b|\bdry\s+utilities\b/, 'utilities_site', 0.8),

  // Interiors framing first (so "metal stud framing" is not wood structure, "steel stud" not steel)
  r('drywall', /drywall|\bgwb\b|\bgyp(sum)?\b|sheetrock|\bhang\b|\btape\b|metal\s+stud|steel\s+stud|stud\s+(framing|walls?)|interior\s+(framing|walls|partitions)|\bpartitions?\b|layout\s+walls|\bsoffits?\b|\bshaft\s*wall\b|\bboard\b/, 'framing_drywall', 0.85),

  // Structure
  r('steel', /\bstl\b|\bsteel\b|\berect(ion)?\b|deck\s*(&|and)\s*detail|metal\s+deck|roof\s+deck|\bjoists?\b|bolt[\s-]?up|plumb\s*(&|and|\/)\s*bolt|moment\s+frames?|\bbracing\b|\bdecking\b/, 'structure_steel', 0.85),
  r('concrete-structure', /\bcip\b|cast[\s-]in[\s-]place|\bcolumns?\b|shear\s+walls?|elevated\s+(slab|deck)|\bpt\s+(slab|deck)|post[\s-]?tension|core\s+walls?|deck\s+pour|pour\s+.*(level|floor|deck|\bl\d+\b)|(level|floor|\bl\d+\b).*\b(pour|slab|deck)\b|\bcmu\b|\bmasonry\b|\bblock\s+walls?\b|\btilt[\s-]?up\s+panels?\b|\bconcrete\s+(frame|structure|superstructure)\b|\bsuperstructure\b/, 'structure_concrete', 0.8),
  r('wood', /wood\s+fram|\bframing\b|\btrusses?\b|\bsheathing\b|rough\s+carpentry|stick\s+fram|\blvl\b|\bclt\b|mass\s+timber|glulam/, 'structure_wood', 0.75),

  // Envelope
  r('roofing', /\broof(ing|s)?\b|membrane|\btpo\b|\bepdm\b|\bpvc\s+roof|\bbur\b|\bsbs\b|flashing|\bcoping\b/, 'roofing', 0.85),
  r('glazing', /curtain\s*wall|store\s*front|windows?|glazing|\bcw\b|\bglass\b|\bskylights?\b/, 'windows_curtainwall', 0.85),
  r('skin', /exterior|\bskin\b|fa[cç]ade|cladding|\bbrick\b|veneer|\beifs\b|metal\s+panels?|\bacm\s+panels?|\bprecast\b|air\s+barrier|\bstucco\b|\bsiding\b|rain\s*screen|\bwall\s+panels?\b|\bstone\b|\benvelope\b/, 'exterior_skin', 0.8),

  // Vertical transport, low voltage, MEP rough
  r('elevators', /elevators?|escalators?|\blifts?\b|hoistway|conveying/, 'elevators', 0.9),
  r('low-voltage', /low[\s-]?voltage|\blv\b|\bdata\s+(cabling|drops|wiring)|\btele(com|phone|data)\b|\bsecurity\b|access\s+control|\bcctv\b|\bav\b|audio[\s-]?visual|structured\s+cabling|\bbms\b|\bbas\b|\bcontrols?\b|\bdas\b|\bnurse\s+call\b/, 'low_voltage', 0.8),
  r('mep-rough', /rough[\s-]?in|\brough\b|\bmep\b|\bmepf?\b|overhead|\boh\b|duct(work)?|piping|plumbing|\bconduit\b|pull\s+(wire|cable|feeders?)|wire\s+pull|\bfeeders?\b|electrical|\belec\b|mechanical|\bmech\b|\bhvac\b|in[\s-]?wall|top[\s-]?out|\bbranch\b|\bplumb\b/, 'mep_rough', 0.8),

  // Finishes, specialties, site
  r('specialties', /specialt|toilet\s+(partition|accessor)|signage|lockers?|fire\s+extinguishers?|corner\s+guards?|window\s+(treatment|shades?)|\bblinds\b|appliances|food\s+service|kitchen\s+equip|\bffe\b|ff\s*&\s*e|furniture|owner\s+equipment/, 'specialties', 0.8),
  r('finishes', /finish|paint|flooring|carpet|\bvct\b|\blvt\b|\btile\b|millwork|casework|ceilings?|\bact\b|\btrim\b|\bdoors?\b|hardware|wall\s*cover|epoxy|terrazzo|polish(ed)?\s+concrete|fixtures?|trim[\s-]?out|\bcabinets?\b|\bcountertops?\b/, 'finishes', 0.8),
  r('paving-landscape', /\bpav(e|ing|ement)\b|asphalt|striping|landscap|hardscape|sidewalks?|\bcurbs?\b|irrigation|site\s+concrete|planting|\bsod\b|\bseed(ing)?\b|parking\s+lot|\bfinal\s+grade\b/, 'paving_landscape', 0.85),
]

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchRules(text: string): { rule: TaxonomyRule; matched: string } | undefined {
  const s = normalizeText(text)
  if (!s) return undefined
  for (const rule of TAXONOMY_RULES) {
    const m = s.match(rule.re)
    if (m) return { rule, matched: m[0].trim() || rule.id }
  }
  return undefined
}

/**
 * Classify an activity name (and optionally its WBS path/name) into a canonical category.
 * The name is the primary signal; WBS text is a secondary signal used to confirm or fill in.
 */
export function classifyActivity(name: string, wbs?: string): Classified {
  const byName = matchRules(name ?? '')
  const byWbs = wbs ? matchRules(wbs) : undefined

  if (byName) {
    let confidence = byName.rule.confidence
    // Very short names ("SC", "DD") are inherently more ambiguous.
    if (normalizeText(name).length <= 3) confidence -= 0.1
    if (byWbs) {
      if (byWbs.rule.category === byName.rule.category) confidence += 0.1
      else if (phaseOf(byWbs.rule.category) !== phaseOf(byName.rule.category)) confidence -= 0.15
    }
    const cat = byName.rule.category
    return { category: cat, phase: phaseOf(cat), confidence: clamp01(confidence), matched: `${byName.rule.id}: ${byName.matched}` }
  }

  if (byWbs) {
    const cat = byWbs.rule.category
    return { category: cat, phase: phaseOf(cat), confidence: clamp01(byWbs.rule.confidence * 0.6), matched: `wbs ${byWbs.rule.id}: ${byWbs.matched}` }
  }

  return { category: 'other', phase: phaseOf('other'), confidence: 0.1 }
}

function clamp01(n: number): number {
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
}

/* ─── Calendar normalization ───────────────────────────── */

export interface NormalizedCalendar {
  canonical: string
  workDays: Weekday[]
  hoursPerDay: number
  confidence: number
  conflict?: string
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON_FRI: Weekday[] = [1, 2, 3, 4, 5]
const MON_THU: Weekday[] = [1, 2, 3, 4]
const MON_SAT: Weekday[] = [1, 2, 3, 4, 5, 6]
const ALL_WEEK: Weekday[] = [0, 1, 2, 3, 4, 5, 6]

interface NameGuess {
  workDays?: Weekday[]
  hoursPerDay?: number
  night?: boolean
  confidence: number
}

function guessFromName(raw: string): NameGuess {
  const s = normalizeText(raw)
  const g: NameGuess = { confidence: 0 }
  const night = /night|graveyard|2nd\s+shift|second\s+shift|3rd\s+shift|third\s+shift|swing/.test(s)
  if (night) g.night = true

  const nxm = s.match(/\b([4-7])\s*[x×]\s*(\d{1,2})\b/)
  const hrs = s.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:-\s*)?(h|hr|hrs|hour|hours)\b/)

  if (/24\s*\/\s*7|24\s*x\s*7|\b24-7\b|around\s+the\s+clock|continuous/.test(s)) {
    return { workDays: ALL_WEEK, hoursPerDay: 24, confidence: 0.9, night }
  }
  if (nxm) {
    const n = Number(nxm[1])
    g.workDays = n === 4 ? MON_THU : n === 5 ? MON_FRI : n === 6 ? MON_SAT : ALL_WEEK
    g.hoursPerDay = Number(nxm[2])
    g.confidence = 0.9
  } else if (/\b7[\s-]?day|seven[\s-]day|\bmon(day)?\s*[-–to]+\s*sun(day)?\b|\bm\s*-\s*su\b|\bevery\s+day\b|\bdaily\b/.test(s)) {
    g.workDays = ALL_WEEK
    g.confidence = 0.85
  } else if (/\b6[\s-]?day|six[\s-]day|\bsat(urday)?\s+work|\bmon(day)?\s*[-–to]+\s*sat(urday)?\b|\bm\s*-\s*sa\b|\bincl(uding|\.)?\s+sat/.test(s)) {
    g.workDays = MON_SAT
    g.confidence = 0.85
  } else if (/\b4[\s-]?day|four[\s-]day|\bmon(day)?\s*[-–to]+\s*thu(r|rs|rsday)?\b|\bm\s*-\s*th\b/.test(s)) {
    g.workDays = MON_THU
    g.hoursPerDay = 10
    g.confidence = 0.85
  } else if (/\b5[\s-]?day|five[\s-]day|\bmon(day)?\s*[-–to]+\s*fri(day)?\b|\bm\s*-\s*f\b|\bweekdays?\b/.test(s)) {
    g.workDays = MON_FRI
    g.confidence = 0.85
  } else if (/\bstandard\b|\bdefault\b|\bnormal\b|\bregular\b|\bglobal\b|\bproject\s+calendar\b|\bday\s+shift\b/.test(s) || night) {
    g.workDays = MON_FRI
    g.confidence = 0.65
  }
  if (hrs) {
    g.hoursPerDay = Number(hrs[1])
    g.confidence = Math.max(g.confidence, 0.6)
  }
  return g
}

function formatDays(days: Weekday[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return 'Sun–Sat'
  if (sorted.length === 0) return 'none'
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  if (contiguous && sorted.length > 1) return `${DAY_ABBR[sorted[0]]}–${DAY_ABBR[sorted[sorted.length - 1]]}`
  return sorted.map((d) => DAY_ABBR[d]).join(', ')
}

export function canonicalCalendarLabel(workDays: Weekday[], hoursPerDay: number, night = false): string {
  const days = [...new Set(workDays)]
  const h = Number.isInteger(hoursPerDay) ? String(hoursPerDay) : hoursPerDay.toFixed(1)
  return `${days.length}-day (${formatDays(days)}) × ${h}h${night ? ' night shift' : ''}`
}

function sameDays(a: Weekday[], b: Weekday[]): boolean {
  const x = [...new Set(a)].sort()
  const y = [...new Set(b)].sort()
  return x.length === y.length && x.every((d, i) => d === y[i])
}

/**
 * Normalize a calendar label (and explicit work days/hours from the source file, when present) to an
 * explicit work week. Explicit file data is trusted over the label; contradictions are reported.
 */
export function normalizeCalendar(input: { name: string; workDays?: number[]; hoursPerDay?: number }): NormalizedCalendar {
  const guess = guessFromName(input.name ?? '')
  const fileDays = (input.workDays ?? []).filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6)
  const hasFileDays = fileDays.length > 0
  const fileHours = typeof input.hoursPerDay === 'number' && input.hoursPerDay > 0 && input.hoursPerDay <= 24 ? input.hoursPerDay : undefined

  const conflicts: string[] = []
  let workDays: Weekday[]
  let confidence: number

  if (hasFileDays) {
    workDays = [...new Set(fileDays)].sort((a, b) => a - b) as Weekday[]
    if (guess.workDays && !sameDays(guess.workDays, workDays)) {
      conflicts.push(`Label "${input.name}" implies ${formatDays(guess.workDays)} but the file defines ${formatDays(workDays)}; using the file's work days.`)
      confidence = 0.5
    } else {
      confidence = guess.workDays ? 0.95 : 0.85
    }
  } else if (guess.workDays) {
    workDays = guess.workDays
    confidence = guess.confidence
  } else {
    workDays = MON_FRI
    confidence = 0.3
  }

  let hoursPerDay: number
  if (fileHours !== undefined) {
    hoursPerDay = fileHours
    if (guess.hoursPerDay !== undefined && Math.abs(guess.hoursPerDay - fileHours) > 0.01) {
      conflicts.push(`Label "${input.name}" implies ${guess.hoursPerDay}h/day but the file defines ${fileHours}h/day; using the file's hours.`)
      confidence = Math.min(confidence, 0.5)
    }
  } else {
    hoursPerDay = guess.hoursPerDay ?? 8
    if (guess.hoursPerDay === undefined && !hasFileDays) confidence = Math.min(confidence, Math.max(0.3, confidence - 0.05))
  }

  const out: NormalizedCalendar = {
    canonical: canonicalCalendarLabel(workDays, hoursPerDay, guess.night),
    workDays,
    hoursPerDay,
    confidence: clamp01(confidence),
  }
  if (conflicts.length) out.conflict = conflicts.join(' ')
  return out
}
