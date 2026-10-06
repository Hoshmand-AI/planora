// WBS used by the P6-style exports: Project → Phase → (work package when split into segments) → activity.
// Activities keep CPM order (early start) inside each node, like a P6 layout grouped by WBS.

import type { CanonicalCategory, GeneratedSchedule, PlanActivity, CpmTimes, ProjectType } from '@/lib/planning/types'
import { PHASES, isCivilType } from '@/lib/planning/types'

export interface WbsNode {
  code: string          // e.g. "PLN.03.02"
  name: string
  level: number         // 1 = phase, 2 = work package
  start: string | null
  finish: string | null
  critical: boolean
  children: WbsNode[]
  activities: PlanActivity[]
}

export interface WbsRow {
  kind: 'wbs' | 'activity'
  level: number         // indentation depth: wbs level, or parent level + 1 for activities
  code: string          // WBS code or activity ID
  name: string
  node?: WbsNode
  activity?: PlanActivity
  times?: CpmTimes
  wbsCode: string       // WBS code the row belongs to
}

export const PHASE_LABELS: Record<string, string> = {
  preconstruction: 'Preconstruction', design: 'Design', permitting: 'Permits & Approvals', procurement: 'Procurement',
  sitework: 'Sitework', structure: 'Structure', envelope: 'Building Envelope', mep: 'MEP Systems',
  interiors: 'Interiors', commissioning: 'Commissioning', closeout: 'Closeout',
}

/**
 * Civil / infrastructure work has no envelope, MEP or interiors: bridges, rail lines and plants are
 * described in their own terms (pilot finding: a bridge's overview read "MEP Systems, Interiors").
 */
const CIVIL_PHASE_LABELS: Record<string, string> = {
  ...PHASE_LABELS, sitework: 'Civil & Sitework', structure: 'Structures', envelope: 'Enclosures', mep: 'Systems & Equipment',
  interiors: 'Finishes', commissioning: 'Testing, Startup & Acceptance',
}
const CIVIL_TYPE_PHASE_LABELS: Partial<Record<ProjectType, Record<string, string>>> = {
  highway_bridge: { sitework: 'Right-of-Way, Roadway & Drainage', structure: 'Bridge Structure', commissioning: 'Traffic Switch & Acceptance' },
  transit_rail: { sitework: 'Right-of-Way & Civil', structure: 'Structures, Platforms & Guideway', mep: 'Track, Traction Power & Train Control', commissioning: 'Systems Testing & Safety Certification' },
  water_wastewater: { sitework: 'Civil, Yard Piping & Restoration', structure: 'Process Structures', mep: 'Process, Electrical & Controls' },
  utility_power: { structure: 'Foundations & Steel Structures', mep: 'Electrical Equipment, Bus & Protection', commissioning: 'Testing, Outage & Energization' },
  industrial_process: { structure: 'Foundations & Steel', mep: 'Process Equipment, Electrical & Controls' },
}
/** Categories that only occur in civil networks: an uploaded schedule with these is described as civil work. */
const CIVIL_ONLY = new Set<CanonicalCategory>([
  'row_utilities', 'traffic_control', 'in_water_work', 'substructure', 'superstructure', 'deck', 'roadway', 'drainage',
  'pipeline', 'process_structures', 'process_equipment', 'track_systems', 'controls_scada', 'startup_testing', 'cutover',
])

/**
 * Phase names for this project: building names for buildings, civil names for civil types (or, when the
 * type is not known, for a network whose activities are clearly civil).
 */
export function phaseLabelsFor(projectType?: string | null, categories: Iterable<string> = []): Record<string, string> {
  if (projectType && isCivilType(projectType)) return { ...CIVIL_PHASE_LABELS, ...CIVIL_TYPE_PHASE_LABELS[projectType as ProjectType] }
  if (projectType) return PHASE_LABELS
  let civil = 0, total = 0
  for (const c of categories) { total++; if (CIVIL_ONLY.has(c as CanonicalCategory)) civil++ }
  return total && civil / total >= 0.15 ? CIVIL_PHASE_LABELS : PHASE_LABELS
}

export function projectCode(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').toUpperCase()
  return (letters || 'PLN').slice(0, 6)
}

const minD = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b)
const maxD = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b)

export function buildWbs(s: GeneratedSchedule, projectName: string): { root: string; nodes: WbsNode[]; rows: WbsRow[] } {
  const t = s.cpm?.times || {}
  const root = projectCode(projectName)
  const order = (a: PlanActivity, b: PlanActivity) => (t[a.id]?.earlyStart || '').localeCompare(t[b.id]?.earlyStart || '') || a.code.localeCompare(b.code)
  const nodes: WbsNode[] = []
  // Uploaded schedules keep their own WBS (P6 PROJWBS path / MSP outline), not Planora's phases.
  if (s.activities.some(a => a.wbs)) return buildSourceWbs(s, root, order, t)
  let pi = 0
  // Generated plans: judge by the template work packages (permits and procurement are shared by every type).
  const work = s.activities.filter(a => a.id.startsWith('t-'))
  const labels = phaseLabelsFor(null, (work.length ? work : s.activities).map(a => a.category))
  for (const phase of PHASES) {
    const acts = s.activities.filter(a => a.phase === phase).sort(order)
    if (!acts.length) continue
    pi++
    const node: WbsNode = { code: `${root}.${String(pi).padStart(2, '0')}`, name: labels[phase] || phase, level: 1, start: null, finish: null, critical: false, children: [], activities: [] }
    // Segmented activities ("t-finishes#1..n") become a level-2 work package.
    const packages = new Map<string, PlanActivity[]>()
    for (const a of acts) {
      const base = a.id.includes('#') ? a.id.split('#')[0] : ''
      if (base) packages.set(base, [...(packages.get(base) || []), a])
    }
    let wi = 0
    const pkgNode = new Map<string, WbsNode>()
    for (const a of acts) {
      const base = a.id.includes('#') ? a.id.split('#')[0] : ''
      if (base && packages.get(base)!.length > 1) {
        let pn = pkgNode.get(base)
        if (!pn) {
          wi++
          pn = { code: `${node.code}.${String(wi).padStart(2, '0')}`, name: a.name.replace(/ — (Level|Levels|Area|Sequence) .*$/, ''), level: 2, start: null, finish: null, critical: false, children: [], activities: [] }
          pkgNode.set(base, pn)
          node.children.push(pn)
        }
        pn.activities.push(a)
      } else {
        node.activities.push(a)
      }
    }
    const roll = (n: WbsNode) => {
      for (const c of n.children) roll(c)
      for (const x of [...n.activities, ...n.children]) {
        const tm = 'id' in x ? t[(x as PlanActivity).id] : undefined
        const st = tm ? tm.earlyStart : (x as WbsNode).start
        const fi = tm ? tm.earlyFinish : (x as WbsNode).finish
        n.start = minD(n.start, st ?? null)
        n.finish = maxD(n.finish, fi ?? null)
        n.critical = n.critical || (tm ? tm.critical : (x as WbsNode).critical)
      }
    }
    roll(node)
    nodes.push(node)
  }

  return { root, nodes, rows: emitRows(nodes, t) }
}

function emitRows(nodes: WbsNode[], t: Record<string, CpmTimes>): WbsRow[] {
  const rows: WbsRow[] = []
  const emit = (n: WbsNode) => {
    rows.push({ kind: 'wbs', level: n.level, code: n.code, name: n.name, node: n, wbsCode: n.code })
    // Interleave loose activities and packages in start order.
    const items: { start: string; row: () => void }[] = [
      ...n.activities.map(a => ({ start: t[a.id]?.earlyStart || '', row: () => rows.push({ kind: 'activity' as const, level: n.level + 1, code: a.code, name: a.name, activity: a, times: t[a.id], wbsCode: n.code }) })),
      ...n.children.map(c => ({ start: c.start || '', row: () => emit(c) })),
    ].sort((x, y) => x.start.localeCompare(y.start))
    for (const it of items) it.row()
  }
  for (const n of nodes) emit(n)
  return rows
}

/** WBS tree from source paths like "1.2.3 Foundations" (P6 short names joined by '.', leaf name after a space). */
function buildSourceWbs(s: GeneratedSchedule, root: string, order: (a: PlanActivity, b: PlanActivity) => number, t: Record<string, CpmTimes>) {
  const top: WbsNode[] = []
  const byKey = new Map<string, WbsNode>()
  const nodeFor = (path: string): WbsNode | null => {
    const m = path.trim().match(/^(\S+)(?:\s+(.+))?$/)
    if (!m) return null
    const parts = m[1].split('.').filter(Boolean)
    let parent: WbsNode | null = null
    let key = ''
    parts.forEach((part, i) => {
      key = key ? `${key}.${part}` : part
      let n = byKey.get(key)
      if (!n) {
        const name = i === parts.length - 1 && m[2] ? m[2] : part
        n = { code: `${root}.${key}`, name, level: i + 1, start: null, finish: null, critical: false, children: [], activities: [] }
        byKey.set(key, n)
        if (parent) parent.children.push(n)
        else top.push(n)
      }
      parent = n
    })
    return parent
  }
  const loose: PlanActivity[] = []
  for (const a of [...s.activities].sort(order)) {
    const n = a.wbs ? nodeFor(a.wbs) : null
    if (n) n.activities.push(a)
    else loose.push(a)
  }
  if (loose.length) top.push({ code: `${root}.UNASSIGNED`, name: 'No WBS', level: 1, start: null, finish: null, critical: false, children: [], activities: loose })
  const roll = (n: WbsNode) => {
    for (const c of n.children) roll(c)
    for (const a of n.activities) {
      const tm = t[a.id]
      n.start = minD(n.start, tm?.earlyStart ?? null)
      n.finish = maxD(n.finish, tm?.earlyFinish ?? null)
      n.critical = n.critical || !!tm?.critical
    }
    for (const c of n.children) { n.start = minD(n.start, c.start); n.finish = maxD(n.finish, c.finish); n.critical = n.critical || c.critical }
  }
  top.forEach(roll)
  return { root, nodes: top, rows: emitRows(top, t) }
}
