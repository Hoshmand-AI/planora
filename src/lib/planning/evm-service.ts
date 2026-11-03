// Server-side loading for earned value (src/lib/analysis/evm.ts): reads each upload's stored original
// file for its cost data (src/lib/parsers/costs.ts), resolves the designated baseline's budget with the
// same precedence as the baseline resolver (src/lib/analysis/baseline.ts), and builds the EVM inputs
// for one update or the whole update series. Every read is organization (and workspace) scoped.

import type { Activity, Schedule } from '@/lib/db'
import type { ResolvedBaseline } from '@/lib/analysis/baseline'
import { costDataFromFile, isP6Cost, type CostData } from '@/lib/parsers/costs'
import { computeEvm, evmSeries, type EvmAnalysis, type EvmCostInput, type EvmInput, type EvmSeries } from '@/lib/analysis/evm'
import { orderSeries } from '@/lib/analysis/compare'
import { loadScheduleData, loadSeriesUpdates, remeasureSeries, type ScheduleBasis } from './service'

type Loaded = NonNullable<Awaited<ReturnType<typeof loadScheduleData>>>

/** Cost data of uploads, read once per request. */
export class CostCache {
  private files = new Map<string, Promise<{ cost: CostData | null; stored: boolean }>>()
  private acts = new Map<string, Promise<Activity[]>>()
  constructor(private orgId: string) {}
  cost(scheduleId: string) {
    let p = this.files.get(scheduleId)
    if (!p) {
      p = (async () => {
        const { getScheduleFile } = await import('@/lib/db')
        const f = await getScheduleFile(scheduleId, this.orgId).catch(() => undefined)
        if (!f) return { cost: null, stored: false }
        const cost = await costDataFromFile(f.fileName, f.content).catch(() => null)
        return { cost, stored: true }
      })()
      this.files.set(scheduleId, p)
    }
    return p
  }
  activities(scheduleId: string) {
    let p = this.acts.get(scheduleId)
    if (!p) {
      p = import('@/lib/db').then(m => m.getActivities(scheduleId))
      this.acts.set(scheduleId, p)
    }
    return p
  }
}

/** File cost records re-keyed from source id to activity code. */
export function costByCode(cost: CostData, activities: Pick<Activity, 'activityId' | 'sourceId'>[]): EvmCostInput {
  const byCode: EvmCostInput['byCode'] = {}
  for (const a of activities) {
    const r = (a.sourceId && cost.bySource[a.sourceId]) || (cost.kind === 'excel' ? cost.bySource[a.activityId] : undefined)
    if (r && a.activityId && !byCode[a.activityId]) byCode[a.activityId] = r
  }
  return { kind: cost.kind, byCode, fields: cost.fields, currency: cost.currency, evMethod: cost.evMethod, notes: cost.notes }
}

/**
 * The designated baseline's budget per activity code:
 *   baseline_upload  the Baseline upload's own baseline cost, else its budget (its plan when it was the baseline)
 *   p6_embedded      the embedded P6 baseline project's budgeted cost (resource assignments + expenses)
 *   file             MS Project / sheet: the file's Baseline Cost; P6: its budgeted cost (P6 uses the
 *                    current project as its own baseline when no baseline project is assigned)
 *   none             no budget (earned value is not available)
 */
export async function baselineBudgetFor(
  baseline: Pick<ResolvedBaseline, 'source' | 'scheduleId' | 'label'>,
  ctx: { cache: CostCache; current: EvmCostInput | null; embeddedOwner: { cost: CostData | null; projectId: string | null } | null },
): Promise<EvmInput['baselineBudget']> {
  if (baseline.source === 'baseline_upload' && baseline.scheduleId) {
    const [{ cost }, acts] = await Promise.all([ctx.cache.cost(baseline.scheduleId), ctx.cache.activities(baseline.scheduleId)])
    if (!cost) return null
    const c = costByCode(cost, acts)
    const byCode: Record<string, number> = {}
    let fromBaseline = 0
    for (const [code, r] of Object.entries(c.byCode)) {
      const v = r.baselineBudget ?? r.budget
      if (v == null) continue
      if (r.baselineBudget != null) fromBaseline++
      byCode[code] = v
    }
    if (!Object.keys(byCode).length) return null
    return { byCode, basis: `the budget of the Baseline upload "${baseline.label ?? ''}" (${fromBaseline ? 'its baseline cost' : isP6Cost(cost.kind) ? 'P6 budgeted cost of resource assignments and expenses' : 'its planned cost'})` }
  }
  if (baseline.source === 'p6_embedded') {
    const own = ctx.embeddedOwner
    const byCode = own?.cost && own.projectId ? own.cost.budgetByProjectCode?.[own.projectId] : undefined
    if (!byCode || !Object.keys(byCode).length) return null
    return { byCode: { ...byCode }, basis: `the budgeted cost (resource assignments and expenses) of the P6 project baseline "${baseline.label ?? ''}" embedded in the file` }
  }
  if (baseline.source === 'file' && ctx.current) {
    const p6 = isP6Cost(ctx.current.kind)
    const byCode: Record<string, number> = {}
    for (const [code, r] of Object.entries(ctx.current.byCode)) {
      const v = p6 ? r.budget : r.baselineBudget
      if (v != null) byCode[code] = v
    }
    if (!Object.keys(byCode).length) return null
    return { byCode, basis: p6 ? "the file's P6 budgeted cost (resource assignments and expenses), with its target dates as the baseline" : ctx.current.kind === 'ms_xml' ? "the file's MS Project Baseline Cost" : "the sheet's baseline cost column" }
  }
  return null
}

/** The EVM input of one loaded update, measured against `baseline` (its own, or the series anchor's). */
export async function evmInputFor(d: Pick<Loaded, 'schedule' | 'activities' | 'baseline'>, cache: CostCache, embeddedOwner?: Pick<Schedule, 'id' | 'baselineMeta'> | null): Promise<EvmInput> {
  const { cost, stored } = await cache.cost(d.schedule.id)
  const current = cost ? costByCode(cost, d.activities) : null
  let owner: { cost: CostData | null; projectId: string | null } | null = null
  if (d.baseline.source === 'p6_embedded') {
    const o = embeddedOwner ?? d.schedule
    owner = { cost: o.id === d.schedule.id ? cost : (await cache.cost(o.id)).cost, projectId: o.baselineMeta?.embedded?.projectId ?? null }
  }
  const baselineBudget = await baselineBudgetFor(d.baseline, { cache, current, embeddedOwner: owner })
  return {
    scheduleId: d.schedule.id, version: d.schedule.version, dataDate: d.schedule.dataDate,
    activities: d.activities, calendars: d.schedule.calendars, defaultCalendarId: d.schedule.defaultCalendarId,
    baseline: { source: d.baseline.source, header: d.baseline.header, starts: d.baseline.starts, finishes: d.baseline.finishes },
    cost: current, costMissing: cost ? null : stored || d.schedule.sourceType === 'generated' ? 'no_cost_data' : 'no_cost_file',
    baselineBudget,
  }
}

/**
 * Earned value of one upload (with its resolved baseline), with the between-update checks against the
 * previous period's upload of the series (a same-data-date reissue is not a previous period).
 */
export async function loadScheduleEvm(orgId: string, id: string, opts: { basis?: ScheduleBasis } = {}): Promise<{ data: Loaded; evm: EvmAnalysis } | null> {
  const data = await loadScheduleData(id, orgId, opts)
  if (!data) return null
  const cache = new CostCache(orgId)
  let prior: EvmInput['prior'] = null
  const s = data.schedule
  if (s.projectKey && s.dataDate) {
    const { getScheduleSeries } = await import('@/lib/db')
    const series = orderSeries(await getScheduleSeries(orgId, s.projectKey))
    const prev = [...series].reverse().find(x => x.id !== s.id && x.dataDate && x.dataDate < s.dataDate!)
    const p = prev ? await loadScheduleData(prev.id, orgId, opts) : null
    if (p) {
      const [pm] = remeasureSeries([p, data], s.id)
      // Each file's own copy of an embedded P6 baseline supplies its budget (so a changed copy is caught).
      const pin = await evmInputFor(pm, cache, pm.schedule.baselineMeta?.embedded ? null : s)
      const pe = computeEvm(pin)
      if (pe.metrics) prior = { version: pe.version, dataDate: pe.dataDate, bac: pe.metrics.bac, baselineHeader: pe.baseline.header, baselineBudgetByCode: pe.baselineBudgetByCode }
    }
  }
  const input = await evmInputFor(data, cache)
  return { data, evm: computeEvm({ ...input, prior }) }
}

/** Earned value per update of loaded series updates (already remeasured to the anchor's baseline). */
export async function evmSeriesFrom(orgId: string, updates: Loaded[], anchorId: string, cache = new CostCache(orgId)): Promise<EvmSeries> {
  const anchor = updates.find(u => u.schedule.id === anchorId) ?? null
  const inputs: { input: EvmInput }[] = []
  for (const u of updates) {
    // An embedded P6 baseline's budget comes from the update's own copy of it, else the anchor's file.
    const owner = u.baseline.source === 'p6_embedded' && !u.schedule.baselineMeta?.embedded && anchor ? anchor.schedule : null
    inputs.push({ input: await evmInputFor(u, cache, owner) })
  }
  return evmSeries(inputs)
}

/** Earned value per update of the series of `schedule`, against the anchor's baseline, reissues superseded. */
export async function loadEvmSeries(orgId: string, schedule: Pick<Schedule, 'id' | 'projectKey'>, opts: { basis?: ScheduleBasis } = {}): Promise<{ series: EvmSeries; truncated: boolean; total: number; updates: Loaded[] }> {
  const { updates, truncated, total } = await loadSeriesUpdates(orgId, schedule, opts)
  return { series: await evmSeriesFrom(orgId, updates, schedule.id), truncated, total, updates }
}
