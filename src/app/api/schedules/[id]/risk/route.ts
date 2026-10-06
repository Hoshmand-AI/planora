import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { loadFirmHistory, loadScheduleData } from '@/lib/planning/service'
import { runSra, type SraResult } from '@/lib/planning/sra'
import { uploadedToGenerated } from '@/lib/planning/uploaded'
import type { ProjectType } from '@/lib/planning/types'

// Results depend only on the upload (uploads are immutable), so recent ones are cached per instance.
const cache = new Map<string, SraResult>()

/** Monte Carlo schedule risk analysis of an uploaded schedule (the contractor's own network). */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  requireFeature(auth.plan, entitlementsFor(auth.plan).sra, 'Monte Carlo schedule risk analysis')
  const data = await loadScheduleData(params.id, auth.orgId)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!data.cpm) return NextResponse.json({ error: 'This schedule has no activity relationships, so a risk analysis of its network is not possible.' }, { status: 400 })
  const key = `${data.schedule.id}:${data.analysis.progressMode}`
  let result = cache.get(key)
  if (!result) {
    const g = uploadedToGenerated(data.schedule, data.activities, data.relationships, data.cpm, data.analysis)
    const history = await loadFirmHistory(auth.orgId, (data.schedule.projectType as ProjectType) || undefined)
    result = runSra(g, {}, history)
    cache.set(key, result)
    if (cache.size > 50) cache.delete(cache.keys().next().value!)
  }
  return NextResponse.json(result)
})
