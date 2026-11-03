// What kind of work an activity of an UPLOADED schedule is, from its name and normalized category.
// Uploaded activity names are the contractor's own; the taxonomy can map "Fabricate structural steel"
// to the steel category, which is right for reporting but wrong for risk: its duration depends on a
// shop and a truck, not on field productivity. Recovery (what to crash) and Monte Carlo ranges use this.
//
// Kinds:
//   by_others   work by others: "by others", owner-furnished (OFCI/OFOI), NIC, utility relocation by
//               the utility owner — the contractor cannot add crews to it
//   closeout    after the contract milestone by nature: punch list, defects / warranty period,
//               as-builts / record drawings, closeout, demobilization
//   cure        cure time (chemistry and spec)
//   fixed       fixed-duration processes: biological seeding / acclimation, lab turnaround, test results
//   procurement fabrication / delivery / submittals — can be expedited with the supplier, not crashed
//   permit      regulatory / agency review, permits, inspections and approvals
//   design      design and drawing production
//   field       everything else (crews can be added, work can be split)

export type WorkKind = 'procurement' | 'cure' | 'permit' | 'design' | 'field' | 'fixed' | 'by_others' | 'closeout'

const BY_OTHERS = /\b(by\s+others|by\s+(the\s+)?(owner|utilit(y|ies)|city|county|state|dot|railroad|others?)|(owner|government|client)[\s-]*(furnished|supplied|provided)|ofci|ofoi|gfe|n\.?i\.?c\.?|not\s+in\s+contract|utility\s+(owner|company|companies|relocations?)|relocat\w*\s+(of\s+)?(the\s+)?(existing\s+)?(utilit\w*|power|gas|electric\w*|telecom\w*|fiber|overhead|aerial|poles?)|(utilit\w*|power|gas|electric|telecom|fiber|overhead)\s+(line\s+)?relocat\w*)\b/i
const CLOSEOUT = /\b(punch\s*-?\s*lists?|punchlist|defects?\s+(liability|notification|correction|period)|warranty(\s+period)?|as[\s-]?builts?|record\s+drawings|close[\s-]?out|demobiliz\w*|o\s*&\s*m\s+manuals|final\s+(cleaning|payment|acceptance\s+documents))\b/i
// "cure", "curing", "cure time" — not "secure"/"procure" (word boundary).
const CURE = /\b(cure|cures|cured|curing)\b/i
const FIXED = /\b(acclimat\w*|biological\s+(seeding|start[\s-]?up|process|establishment)|seed(ing)?\s+(of\s+)?(the\s+)?(bio\w*|aeration|digesters?|basins?|reactors?|sludge|clarifiers?)|bio[\s-]?(mass|logical)\s+(growth|seeding)|lab(oratory)?\s+(testing|tests?|analysis|results?|turn[\s-]?around)|test\s+results?|cylinder\s+breaks?|break\s+tests?)\b/i
const PROCUREMENT = /\b(fabricat\w*|deliver\w*|procure\w*|submittals?|shop\s*drawings?|lead[\s-]?times?|purchas\w*|buyout|manufactur\w*|shipp?\w*|order(s|ed|ing)?|po\s+issue)\b/i
const PERMIT = /\b(permit\w*|ahj\s+review|plan\s+review|agency\s+(review|approval)|regulator\w*|(epa|dep|deq|usace|fhwa|faa|nepa|dot)\s+(review|approval|concurrence)|review\s+by\s+(the\s+)?(agency|regulator|state|city|county)|inspections?|approvals?\s+by|consent\s+order)\b/i
const DESIGN = /\b(design|drawings? (?:production|development)|construction documents|schematic|ifc set)\b/i

export function workKind(name: string, category?: string | null, phase?: string | null): WorkKind {
  const cat = category || ''
  if (BY_OTHERS.test(name)) return 'by_others'
  if (CLOSEOUT.test(name)) return 'closeout'
  if (CURE.test(name)) return 'cure'
  if (FIXED.test(name)) return 'fixed'
  if (cat === 'procurement' || cat === 'submittals' || PROCUREMENT.test(name)) return 'procurement'
  if (cat.startsWith('permit') || PERMIT.test(name)) return 'permit'
  if (phase === 'design' || DESIGN.test(name)) return 'design'
  return 'field'
}

/** Why recovery never crashes or overlaps this kind of work (null for field work). */
export const NOT_CRASHABLE: Partial<Record<WorkKind, string>> = {
  by_others: 'work by others (the contractor cannot add crews to it)',
  closeout: 'close-out work after the contract milestone',
  cure: 'fixed-duration cure time',
  fixed: 'a fixed-duration process (biological seeding / acclimation, lab turnaround)',
  permit: 'a regulatory / agency review, permit or inspection period',
  procurement: 'supplier-driven (expedite with the supplier instead of adding crews)',
  design: 'design work (re-plan with the designer)',
}
