import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { getScheduleById } from '@/lib/db'
import { getDelayEvent, getTiaRun } from '@/lib/tia-db'
import { loadProvenance } from '@/lib/export/provenance'
import { exportMarking, markText } from '@/lib/export/markings'
import { scheduleClassification } from '@/lib/server/classification'
import { exportTiaPdf, exportTiaXlsx, tiaMarkdown, type TiaReportInput } from '@/lib/export/tia-report'
import { tiaNarrativeWithAi } from '@/lib/export/tia-ai'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

async function load(params: { id: string; eventId: string; runId: string }, orgId: string) {
  const [schedule, event, run] = await Promise.all([getScheduleById(params.id, orgId), getDelayEvent(params.eventId, params.id, orgId), getTiaRun(params.runId, params.eventId, orgId)])
  if (!schedule || !event || !run) return null
  return { schedule, event, run }
}

/**
 * One TIA run and its report.
 *   GET ?format=json (default) → the run
 *   GET ?format=md | xlsx | pdf → the TIA report (template narrative, no model): disclaimer, delay
 *       event with evidence links, assumptions, milestone impact, driving path before/after, concurrency
 *       indicators, provenance and the inputs / result hashes. CUI / classified schedules carry markings.
 *   POST → an AI-written narrative that only explains the computed results (validated; offline or on
 *       any failure the deterministic template), with the report in Markdown. Needs ai.use.
 */
export const GET = api<{ id: string; eventId: string; runId: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const x = await load(params, auth.orgId)
  if (!x) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const format = req.nextUrl.searchParams.get('format') || 'json'
  if (format === 'json') return NextResponse.json({ run: x.run, event: x.event })
  if (!['md', 'xlsx', 'pdf'].includes(format)) return NextResponse.json({ error: 'Unknown format. Use json, md, xlsx or pdf.' }, { status: 400 })
  const rl = await hit(`export:user:${auth.userId}`, LIMITS.exportsPerUser.limit, LIMITS.exportsPerUser.windowSec)
  if (!rl.ok) throw new ApiError(429, 'Too many exports in the last hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  const { schedule, event, run } = x
  const classification = await scheduleClassification(schedule.id, auth.orgId).catch(() => 'classified' as const)
  const marking = exportMarking(classification, { controlledBy: auth.orgName, poc: auth.name })
  const prov = await loadProvenance(auth.orgId, [{ schedule, analysis: schedule.analysis ?? null, editsApplied: run.result.update.editsApplied }], auth.settings.quality)
  const input: TiaReportInput = { event, run, provenance: prov, notes: typeof run.inputs.acceptanceNote === 'string' ? [run.inputs.acceptanceNote] : [] }
  const slug = (`tia-${event.title}-${schedule.version}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'tia').slice(0, 80)
  let body: string | Buffer | Uint8Array, type: string, file: string
  const md = markText(tiaMarkdown(input), marking)
  if (format === 'md') { body = md; type = 'text/markdown; charset=utf-8'; file = `${slug}.md` }
  else if (format === 'xlsx') { body = await exportTiaXlsx(input, prov, marking); type = XLSX; file = `${slug}.xlsx` }
  else { body = await exportTiaPdf(tiaMarkdown(input), `Time Impact Analysis — ${event.title}`, marking); type = 'application/pdf'; file = `${slug}.pdf` }
  await audit({ action: 'tia.report', targetType: 'schedule', targetId: schedule.id, detail: { delayEventId: event.id, runId: run.id, format, file, inputsHash: run.inputsHash, marking: marking?.banner ?? null, sha256: createHash('sha256').update(body).digest('hex') } })
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${file}"` } })
})

export const POST = api<{ id: string; eventId: string; runId: string }>({ permission: 'ai.use' }, async (_req, { params, auth }) => {
  const x = await load(params, auth.orgId)
  if (!x) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { schedule, event, run } = x
  const narrative = await tiaNarrativeWithAi(run.result, event)
  const classification = await scheduleClassification(schedule.id, auth.orgId).catch(() => 'classified' as const)
  const marking = exportMarking(classification, { controlledBy: auth.orgName, poc: auth.name })
  const prov = await loadProvenance(auth.orgId, [{ schedule, analysis: schedule.analysis ?? null, editsApplied: run.result.update.editsApplied }], auth.settings.quality)
  const content = markText(tiaMarkdown({ event, run, provenance: prov, narrative, notes: typeof run.inputs.acceptanceNote === 'string' ? [run.inputs.acceptanceNote] : [] }), marking)
  // Prompt content is never logged; only that a narrative was produced and how.
  await audit({ action: 'tia.narrative', targetType: 'schedule', targetId: schedule.id, detail: { delayEventId: event.id, runId: run.id, source: narrative.source, model: narrative.model, inputsHash: run.inputsHash } })
  return NextResponse.json({ narrative: narrative.text, source: narrative.source, model: narrative.model, note: narrative.note, content })
})
