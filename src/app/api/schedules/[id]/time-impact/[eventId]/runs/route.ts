import { NextResponse } from 'next/server'
import { randomUUID as uuid } from 'crypto'
import { api, body as readBody } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { addTiaRun, getDelayEvent, listTiaRuns, updateDelayEvent } from '@/lib/tia-db'
import { basisFrom } from '@/lib/planning/service'
import { runTia, tiaInputs, TIA_DISCLAIMER } from '@/lib/analysis/tia'
import { loadTiaContext } from '@/lib/server/tia-service'

/**
 * TIA runs of a delay event (immutable).
 *   GET  → { runs (newest first), disclaimer }
 *   POST { basis?: 'submitted' | 'scenario' } → inserts the event's fragnet into the update as of its
 *        data date, recalculates, and stores the run (inputs hash, before / after, result). A fragnet
 *        that does not validate returns 400 with the errors and stores nothing. Needs schedule.write; audited.
 */
export const GET = api<{ id: string; eventId: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const event = await getDelayEvent(params.eventId, params.id, auth.orgId)
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ runs: await listTiaRuns(event.id, auth.orgId), disclaimer: TIA_DISCLAIMER })
})

export const POST = api<{ id: string; eventId: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const event = await getDelayEvent(params.eventId, params.id, auth.orgId)
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await readBody<Record<string, unknown>>(req).catch(() => ({}))
  const ctx = await loadTiaContext(params.id, auth.orgId, basisFrom(b))
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const evInput = { title: event.title, responsibility: event.responsibility, eventStart: event.eventStart, eventEnd: event.eventEnd, fragnet: event.fragnet }
  const { result, before, after } = runTia(ctx.net, evInput, ctx.previous)
  // A fragnet that does not validate is not stored as a run.
  if (!result.ok) return NextResponse.json({ error: 'The fragnet is not valid yet.', code: 'invalid_fragnet', validation: result.validation }, { status: 400 })
  const run = await addTiaRun(auth.orgId, {
    id: uuid(), delayEventId: event.id, scheduleId: params.id, inputsHash: result.inputsHash, resultHash: result.resultHash, engine: result.engine,
    inputs: { ...tiaInputs(ctx.net, evInput, ctx.previous), previousScheduleId: ctx.previous?.scheduleId ?? null, acceptanceNote: ctx.acceptanceNote }, before, after, result, createdBy: auth.userId,
  })
  if (event.status === 'draft') await updateDelayEvent(event.id, params.id, auth.orgId, auth.userId, { status: 'analyzed' })
  const cm = result.milestones.find(m => m.kind === 'contract')
  await audit({ action: 'tia.run', targetType: 'schedule', targetId: params.id, detail: {
    schedule: ctx.data.schedule.name, version: ctx.data.schedule.version, delayEventId: event.id, runId: run.id, basis: result.update.basis,
    inputsHash: result.inputsHash, resultHash: result.resultHash, contractMilestone: cm?.code ?? null, impactCd: cm?.impactCd.logic ?? null,
    projectFinishImpactCd: result.projectFinish.impactCd.logic, fragnetOnPath: result.drivingPath.fragnetOnPath, concurrencyFlags: result.concurrency.flags.length,
  } })
  return NextResponse.json({ success: true, run, acceptanceNote: ctx.acceptanceNote }, { status: 201 })
})
