import { NextResponse } from 'next/server'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { getScheduleById } from '@/lib/db'
import { basisFrom } from '@/lib/planning/service'
import { runStandards } from '@/lib/standards/engine'
import { configFor, frameworksFrom, loadScheduleStandardsInput } from '@/lib/standards/server'
import { getStandardsRun, listStandardsRuns, saveStandardsRun } from '@/lib/standards/store'
import { RUNNABLE_FRAMEWORKS } from '@/lib/standards/types'

/**
 * Standards rules engine on an uploaded schedule.
 *   GET ?frameworks=PLANORA_COMPOSITE,GAO_SCHEDULE_GUIDE,DCMA_14 (default: the organization's) &basis=scenario
 *       → { result, runs, defaults, available } — runs the frameworks now (not stored) and lists stored runs
 *   GET ?run=<id> → { run } — a stored run exactly as it was recorded
 *   POST { frameworks?, basis? } → runs and records the assessment (schedule.write); audited
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const sp = req.nextUrl.searchParams
  const runId = sp.get('run')
  if (runId) {
    const schedule = await getScheduleById(params.id, auth.orgId)
    if (!schedule) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const run = await getStandardsRun(auth.orgId, 'schedule', schedule.id, runId.slice(0, 64))
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    return NextResponse.json({ run })
  }
  const frameworks = frameworksFrom(sp.get('frameworks'), auth.settings)
  const loaded = await loadScheduleStandardsInput(params.id, auth.orgId, basisFrom(sp))
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const result = runStandards(loaded.input, frameworks, configFor(auth.settings))
  const runs = await listStandardsRuns(auth.orgId, 'schedule', loaded.input.subject.id)
  return NextResponse.json({ result, basis: loaded.basis, runs, defaults: auth.settings.standards.defaultFrameworks, available: RUNNABLE_FRAMEWORKS })
})

export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const b = await readBody<{ frameworks?: unknown; basis?: unknown }>(req)
  const frameworks = frameworksFrom(b.frameworks, auth.settings)
  const loaded = await loadScheduleStandardsInput(params.id, auth.orgId, basisFrom({ basis: b.basis }))
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const cfg = configFor(auth.settings)
  const result = runStandards(loaded.input, frameworks, cfg)
  const saved = await saveStandardsRun({ orgId: auth.orgId, userId: auth.userId, basis: loaded.basis, thresholds: cfg, run: result })
  await audit({ action: 'standards.run', targetType: 'schedule', targetId: loaded.input.subject.id, detail: {
    schedule: loaded.name, version: loaded.input.subject.version ?? null, runId: saved.id, basis: loaded.basis,
    frameworks, rulesVersion: result.rulesVersion, engineVersion: result.engineVersion, summary: saved.summary,
  } })
  return NextResponse.json({ result, saved })
})
