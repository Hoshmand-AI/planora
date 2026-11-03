import { api, body as readBody, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { runStandards } from '@/lib/standards/engine'
import { planStandardsInput } from '@/lib/standards/inputs'
import { configFor, frameworksFrom } from '@/lib/standards/server'
import { getStandardsRun, listStandardsRuns, saveStandardsRun } from '@/lib/standards/store'
import { RUNNABLE_FRAMEWORKS } from '@/lib/standards/types'
import { loadPlanContext } from '../context'

/**
 * Standards rules engine on a generated plan's current schedule.
 *   GET ?frameworks=… (default: the organization's) → { result, runs, defaults, available }
 *   GET ?run=<id> → { run } — a stored run exactly as recorded
 *   POST { frameworks? } → runs and records the assessment (plan.write); audited
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const { plan } = await loadPlanContext(req, params.id, auth)
  const sp = req.nextUrl.searchParams
  const runId = sp.get('run')
  if (runId) {
    const run = await getStandardsRun(auth.orgId, 'plan', plan.id, runId.slice(0, 64))
    if (!run) throw new ApiError(404, 'Run not found')
    return json({ run })
  }
  const frameworks = frameworksFrom(sp.get('frameworks'), auth.settings)
  const input = planStandardsInput(plan)
  if (!input) throw new ApiError(400, 'Generate the schedule first.')
  const result = runStandards(input, frameworks, configFor(auth.settings))
  const runs = await listStandardsRuns(auth.orgId, 'plan', plan.id)
  return json({ result, runs, defaults: auth.settings.standards.defaultFrameworks, available: RUNNABLE_FRAMEWORKS })
})

export const POST = api<{ id: string }>({ permission: 'plan.write' }, async (req, { params, auth }) => {
  const { plan } = await loadPlanContext(req, params.id, auth)
  const b = await readBody<{ frameworks?: unknown }>(req)
  const frameworks = frameworksFrom(b.frameworks, auth.settings)
  const input = planStandardsInput(plan)
  if (!input) throw new ApiError(400, 'Generate the schedule first.')
  const cfg = configFor(auth.settings)
  const result = runStandards(input, frameworks, cfg)
  const saved = await saveStandardsRun({ orgId: auth.orgId, userId: auth.userId, basis: null, thresholds: cfg, run: result })
  await audit({ action: 'standards.run', targetType: 'plan', targetId: plan.id, detail: {
    plan: plan.name, version: plan.version, runId: saved.id, frameworks,
    rulesVersion: result.rulesVersion, engineVersion: result.engineVersion, summary: saved.summary,
  } })
  return json({ result, saved })
})
