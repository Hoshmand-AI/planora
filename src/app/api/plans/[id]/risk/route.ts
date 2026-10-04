import { api, json, ApiError } from '@/lib/server/api'
import { runSra, type SraResult } from '@/lib/planning/sra'
import { loadFirmHistory } from '@/lib/planning/service'
import type { ProjectType } from '@/lib/planning/types'
import { loadPlanContext } from '../context'

// Results depend only on the plan version, so recent ones are cached per instance.
const cache = new Map<string, SraResult>()

/** Monte Carlo schedule risk analysis of the plan's current schedule. */
export const GET = api<{ id: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const { plan } = await loadPlanContext(req, params.id, auth)
  if (!plan.generated?.cpm) throw new ApiError(400, 'Generate the schedule first.')
  const key = `${plan.id}:${plan.version}:${plan.generated.generatedAt}`
  let result = cache.get(key)
  if (!result) {
    const history = await loadFirmHistory(auth.orgId, plan.answers['project.type']?.value as ProjectType | undefined)
    result = runSra(plan.generated, plan.answers, history)
    cache.set(key, result)
    if (cache.size > 50) cache.delete(cache.keys().next().value!)
  }
  return json(result)
})
