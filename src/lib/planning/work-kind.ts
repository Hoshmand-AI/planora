// What kind of work an activity of an UPLOADED schedule is, from its name and normalized category.
// Uploaded activity names are the contractor's own; the taxonomy can map "Fabricate structural steel"
// to the steel category, which is right for reporting but wrong for risk: its duration depends on a
// shop and a truck, not on field productivity. Recovery (what to crash) and Monte Carlo ranges use this.

export type WorkKind = 'procurement' | 'cure' | 'permit' | 'design' | 'field'

const PROCUREMENT = /\b(fabricat\w*|deliver\w*|procure\w*|submittals?|shop\s*drawings?|lead[\s-]?times?|purchas\w*|buyout|manufactur\w*|shipp?\w*|order(s|ed|ing)?|po\s+issue)\b/i
// "cure", "curing", "cure time" — not "secure"/"procure" (word boundary).
const CURE = /\b(cure|cures|cured|curing)\b/i
const PERMIT = /\b(permit|ahj review|plan review|agency review)\b/i
const DESIGN = /\b(design|drawings? (?:production|development)|construction documents|schematic|ifc set)\b/i

export function workKind(name: string, category?: string | null, phase?: string | null): WorkKind {
  const cat = category || ''
  if (CURE.test(name)) return 'cure'
  if (cat === 'procurement' || cat === 'submittals' || PROCUREMENT.test(name)) return 'procurement'
  if (cat.startsWith('permit') || PERMIT.test(name)) return 'permit'
  if (phase === 'design' || DESIGN.test(name)) return 'design'
  return 'field'
}
