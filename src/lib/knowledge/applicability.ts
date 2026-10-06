// Applicability rules shared by every knowledge catalog (permits, regulations, long-lead items, templates).
//
// Semantics (tri-state):
//   - A field that is unset on the Applicability never restricts.
//   - projectTypes / scopes / federal flags: if the profile value is unknown the result is 'unknown'
//     (the item is kept so the interview still asks about it).
//   - Numeric thresholds (minSqft, minStories, minAcresDisturbed): if the profile value is unknown the
//     result is 'no' — we do not assume a project is big/tall/large-site without evidence.
//   - Any 'no' wins; otherwise any 'unknown' yields 'unknown'; otherwise 'yes'.
//
// applies() === (appliesTri() !== 'no').

import { isCivilType, type Applicability, type ProjectProfile } from '@/lib/planning/types'

export type Tri = 'yes' | 'no' | 'unknown'

/** Federal status: explicit answer wins; federal_defense implies a federal undertaking. */
export function effectiveFederal(p: ProjectProfile): boolean | undefined {
  if (typeof p.isFederal === 'boolean') return p.isFederal
  if (p.projectType === 'federal_defense') return true
  return undefined
}

function combine(results: Tri[]): Tri {
  if (results.includes('no')) return 'no'
  if (results.includes('unknown')) return 'unknown'
  return 'yes'
}

function threshold(min: number | undefined, value: number | undefined): Tri {
  if (min === undefined) return 'yes'
  if (value === undefined || value === null || Number.isNaN(value)) return 'no'
  return value >= min ? 'yes' : 'no'
}

export function appliesTri(a: Applicability, p: ProjectProfile): Tri {
  const r: Tri[] = []
  // Building catalog items never apply to civil/infrastructure work unless marked (or listing the type).
  if (isCivilType(p.projectType) && !a.civil && !(Array.isArray(a.projectTypes) && a.projectTypes.includes(p.projectType!))) return 'no'

  if (a.projectTypes !== undefined && a.projectTypes !== 'all') {
    if (!p.projectType) r.push('unknown')
    else r.push(a.projectTypes.includes(p.projectType) ? 'yes' : 'no')
  }

  if (a.scopes !== undefined && a.scopes.length > 0) {
    if (!p.scope) r.push('unknown')
    else r.push(a.scopes.includes(p.scope) ? 'yes' : 'no')
  }

  r.push(threshold(a.minSqft, p.grossSqft))
  r.push(threshold(a.minStories, p.stories))
  r.push(threshold(a.minAcresDisturbed, p.siteAcresDisturbed))

  const fed = effectiveFederal(p)
  if (a.federalOnly) r.push(fed === undefined ? 'unknown' : fed ? 'yes' : 'no')
  if (a.nonFederalOnly) r.push(fed === undefined ? 'unknown' : fed ? 'no' : 'yes')

  return combine(r)
}

export function applies(a: Applicability, p: ProjectProfile): boolean {
  return appliesTri(a, p) !== 'no'
}
