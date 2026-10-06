import { NextResponse } from 'next/server'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { getScheduleRiskInputs, saveScheduleRiskInputs } from '@/lib/db'
import { loadFirmHistory, loadScheduleData } from '@/lib/planning/service'
import { runSra, type SraResult } from '@/lib/planning/sra'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import { editsFingerprint } from '@/lib/planning/uploaded-edits'
import { describeRiskInputs, parseRiskInputs } from '@/lib/planning/risk-inputs'
import type { ProjectType } from '@/lib/planning/types'

// Results depend on the upload, its edits and its risk inputs, so recent ones are cached per instance.
const cache = new Map<string, SraResult>()

/**
 * Monte Carlo schedule risk analysis of an uploaded schedule (the contractor's own network, with any
 * edits made in Planora). The scheduler's per-activity ranges and discrete risk events (PUT) are used
 * over the rule-based ranges; activities are classified by name (procurement ranges, fixed cure).
 *   GET → SraResult & { inputs: { ranges, events, updatedAt, defaults } }
 *   PUT { ranges: [{ activityId, optimistic, mostLikely, pessimistic }], events: [{ name, probability (0–1), impactDays, activityId }] }
 *       (work days; activities by Planora id or activity code) — needs schedule.write.
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  requireFeature(auth.plan, entitlementsFor(auth.plan).sra, 'Monte Carlo schedule risk analysis')
  const data = await loadScheduleData(params.id, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!data.cpm) return NextResponse.json({ error: 'This schedule has no activity relationships, so a risk analysis of its network is not possible.' }, { status: 400 })
  const inputs = await getScheduleRiskInputs(data.schedule.id, auth.orgId)
  const key = `${data.schedule.id}:${data.analysis.progressMode}:${editsFingerprint(data.edits)}:${inputs.updatedAt ?? ''}`
  let result = cache.get(key)
  if (!result) {
    const g = uploadedToGenerated(data.schedule, data.activities, data.relationships, data.cpm, data.analysis)
    const history = await loadFirmHistory(auth.orgId, (data.schedule.projectType as ProjectType) || undefined)
    result = runSra(g, {}, history, { inputs: { ranges: inputs.ranges, events: inputs.events, nameRules: true } })
    cache.set(key, result)
    if (cache.size > 50) cache.delete(cache.keys().next().value!)
  }
  return NextResponse.json({ ...result, inputs: describeRiskInputs(inputs.ranges, inputs.events, data.activities, inputs.updatedAt) })
})

export const PUT = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const data = await loadScheduleData(params.id, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await readBody<{ ranges?: unknown; events?: unknown }>(req)
  const parsed = parseRiskInputs(b, data.activities)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error, code: 'invalid_risk_inputs' }, { status: 400 })
  const before = await getScheduleRiskInputs(data.schedule.id, auth.orgId)
  await saveScheduleRiskInputs(data.schedule.id, auth.orgId, parsed, auth.userId)
  await audit({ action: 'schedule.risk_inputs', targetType: 'schedule', targetId: data.schedule.id, detail: {
    schedule: data.schedule.name, version: data.schedule.version,
    rangesBefore: before.ranges.length, rangesAfter: parsed.ranges.length, eventsBefore: before.events.length, eventsAfter: parsed.events.length,
    events: parsed.events.map(e => ({ name: e.name, probability: e.probability, impactDays: e.impactDays })),
  } })
  const saved = await getScheduleRiskInputs(data.schedule.id, auth.orgId)
  return NextResponse.json({ success: true, inputs: describeRiskInputs(saved.ranges, saved.events, data.activities, saved.updatedAt) })
})
