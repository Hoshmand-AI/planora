// WBS used by the P6-style exports: Project → Phase → (work package when split into segments) → activity.
// Activities keep CPM order (early start) inside each node, like a P6 layout grouped by WBS.

import type { GeneratedSchedule, PlanActivity, CpmTimes } from '@/lib/planning/types'
import { PHASES } from '@/lib/planning/types'

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
  let pi = 0
  for (const phase of PHASES) {
    const acts = s.activities.filter(a => a.phase === phase).sort(order)
    if (!acts.length) continue
    pi++
    const node: WbsNode = { code: `${root}.${String(pi).padStart(2, '0')}`, name: PHASE_LABELS[phase] || phase, level: 1, start: null, finish: null, critical: false, children: [], activities: [] }
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
  return { root, nodes, rows }
}
