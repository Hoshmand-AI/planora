// Mission-critical backbone for data centers: the work a data center schedule is judged on, as
// separate activities instead of one "power train" and one "commissioning" bar.
//
//   utility substation → MV switchgear energize ─┐
//   generators set → load bank testing ──────────┤
//   UPS / PDUs set ──────────────────────────────┤→ L2 → L3 → L4 → L5 IST
//   overhead busway → aisle containment ─────────┘
//   L1 factory witness testing follows fabrication of the generators, UPS and MV switchgear.

import type { CanonicalCategory, LinkType, PlanActivity, PlanLink, Rationale, SourceRef } from './types'
import { phaseOf } from '@/lib/semantic/taxonomy'

/** The parts of the generator's network builder this module needs. */
export interface PlanGraph {
  acts: Map<string, PlanActivity>
  links: Map<string, PlanLink>
  add(a: Omit<PlanActivity, 'code'> & { code?: string }): PlanActivity
  link(from: string, to: string, type: LinkType, lag: number, rationale: Rationale): void
  insertBefore(mid: string, target: string, rationale: Rationale): void
}

export interface BackboneContext {
  /** Gross area in 1,000 sf (template sizing unit) */
  ksf: number
  /** Template days are 8-hour days; multiply by this for longer shifts */
  hoursFactor: number
  calendarId: string
}

const src = (label: string, detail?: string): SourceRef => ({ kind: 'template', label, detail })
const why = (summary: string, detail?: string): Rationale => ({ summary, sources: [src('Planora data center backbone', detail)], confidence: 'medium' })
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Share of the template's commissioning duration for each level (L5 IST keeps the rest). */
const LEVELS = [
  { id: 'dc-l2', share: 0.15, name: 'L2 — Equipment receipt inspection & installation verification (generators, UPS, switchgear, CRAHs)' },
  { id: 'dc-l3', share: 0.2, name: 'L3 — Equipment startup & pre-functional checks (energized)' },
  { id: 'dc-l4', share: 0.3, name: 'L4 — Functional performance testing by system (electrical, mechanical, controls, fire)' },
] as const
const L5_SHARE = 0.35

/** Expand a data center network built from the templates into the mission-critical backbone. No-op when the pieces are missing. */
export function addDataCenterBackbone(g: PlanGraph, ctx: BackboneContext): void {
  const comm = g.acts.get('t-commissioning')
  const elec = g.acts.get('t-electrical_service')
  if (!comm || !elec) return
  const days = (base: number, perKsf: number, lo: number, hi: number) => Math.max(1, Math.round(clamp(base + perKsf * ctx.ksf, lo, hi) * ctx.hoursFactor))
  const task = (id: string, name: string, category: CanonicalCategory, duration: number, rationale: Rationale) =>
    g.add({ id, name, category, phase: phaseOf(category), type: 'task', duration, calendarId: ctx.calendarId, rationale })
  const has = (id: string) => g.acts.has(id)

  /* Utility substation, then the MV switchgear it feeds. */
  const sub = task('dc-substation', 'Utility / owner substation & MV service — construct, test & energize (utility-coordinated)', 'electrical_service',
    days(30, 0.1, 30, 90), why('Data center service is taken at medium voltage from a dedicated substation; the utility builds or energizes it before the MV switchgear can be energized.', 'Substation duration scales with load (area); confirm with the utility’s interconnection schedule.'))
  // The utility's service application drives the substation, not the switchgear set.
  for (const l of [...g.links.values()]) {
    if (l.to !== elec.id) continue
    if (l.from.startsWith('permit-')) {
      g.links.delete(l.id)
      g.link(l.from, sub.id, l.type, l.lag, l.rationale)
    }
  }
  const siteStart = has('t-utilities_site') ? 't-utilities_site' : has('t-mobilization') ? 't-mobilization' : 'ntp'
  g.link(siteStart, sub.id, 'FS', 0, why('The substation and duct banks follow site utilities.'))
  g.link(sub.id, elec.id, 'FS', 0, why('MV switchgear is energized from the substation.'))

  /* Generators: set (template), then load bank testing. */
  const gens = g.acts.get('t-power_equipment')
  let loadBank: PlanActivity | undefined
  if (gens) {
    loadBank = task('dc-loadbank', 'Generator load bank testing — each unit, then paralleled on the switchgear', 'startup_testing',
      days(8, 0.03, 8, 30), why('Each generator is load-bank tested (typically 4 hours at full rated load) and then tested in parallel before integrated testing; it needs fuel and controls, not utility power.'))
    g.link(gens.id, loadBank.id, 'FS', 0, why('Load banks are connected once the generators are set, fueled and terminated.'))
  }

  /* Busway and containment in the data halls. */
  const ups = g.acts.get('t-conductors')
  const busway = task('dc-busway', 'Overhead busway, tap-off boxes & data-hall power distribution — install & torque', 'conductors',
    days(15, 0.1, 15, 60), why('Overhead busway feeds the racks from the PDUs/RPPs; it is installed after overhead MEP in the data halls and torque-checked before energizing.'))
  if (has('t-mep_rough')) g.link('t-mep_rough', busway.id, 'SS', Math.round(30 * ctx.hoursFactor), why('Busway follows the overhead mechanical and cable tray in each hall (SS +30d).'))
  else g.link(siteStart, busway.id, 'FS', 0, why('No rough-in in this network; follows site setup.'))
  if (ups) g.link(ups.id, busway.id, 'SS', 0, why('Busway is installed alongside the UPS and PDU set.'))
  const containment = task('dc-containment', 'Hot / cold aisle containment, cable tray & ladder rack in the data halls', 'specialties',
    days(12, 0.08, 12, 60), why('Containment closes the airflow path; it is installed below the busway and must be complete before functional and integrated thermal testing.'))
  g.link(busway.id, containment.id, 'FS', 0, why('Containment panels and doors go in below the installed busway.'))
  if (has('t-dry_in')) g.link('t-dry_in', containment.id, 'FS', 0, why('Containment is installed in a dried-in hall.'))

  /* L1 factory witness tests as the long-lead equipment completes fabrication. */
  const fabs = ['ll-emergency-generator-fab', 'll-ups-fab', 'll-mv-switchgear-fab', 'll-ats-fab'].filter(has)
  let l1: PlanActivity | undefined
  if (fabs.length) {
    l1 = task('dc-l1', 'L1 — Factory witness testing (generators, UPS, MV switchgear, paralleling gear)', 'commissioning', 10,
      why('Owner and commissioning agent witness factory acceptance tests before major electrical equipment ships.'))
    for (const f of fabs) g.link(f, l1.id, 'FF', 0, why('Factory witness testing completes with fabrication, before shipment.'))
  }

  /* L2–L4 inserted ahead of the template commissioning activity, which becomes the L5 IST. */
  const total = comm.duration
  const chain: PlanActivity[] = []
  for (const lv of LEVELS) {
    const a = task(lv.id, lv.name, 'commissioning', Math.max(3, Math.round(total * lv.share)),
      why(`${Math.round(lv.share * 100)}% of the ${total}-day commissioning package from the data center template, as its own level.`))
    g.insertBefore(a.id, comm.id, why('Commissioning levels run in sequence: each level starts once the previous one is signed off.'))
    chain.push(a)
  }
  // Work that started alongside commissioning (e.g. punch list) now starts alongside L2.
  for (const l of [...g.links.values()]) {
    if (l.from === comm.id && l.type === 'SS') { g.links.delete(l.id); g.link(chain[0].id, l.to, 'SS', l.lag, l.rationale) }
  }
  comm.duration = Math.max(5, Math.round(total * L5_SHARE))
  comm.rationale = { ...comm.rationale, summary: `L5 integrated systems test: ${comm.duration} work days (${Math.round(L5_SHARE * 100)}% of the ${total}-day commissioning package; L2–L4 are separate activities). ${comm.rationale.summary}` }
  const [l2, l3, l4] = chain
  if (l1) g.link(l1.id, l2.id, 'FS', 0, why('Installed equipment is verified against its factory test results.'))
  g.link(busway.id, l2.id, 'FS', 0, why('Busway is inspected and verified with the rest of the power train.'))
  if (loadBank) g.link(loadBank.id, l3.id, 'FS', 0, why('Generators are load-bank tested before system startup relies on them.'))
  g.link(containment.id, l4.id, 'FS', 0, why('Functional thermal testing needs the containment in place.'))
}
