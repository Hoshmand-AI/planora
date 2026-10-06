import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { entitlementsFor, requireFeature } from '@/lib/server/entitlements'
import { hit, LIMITS } from '@/lib/server/rate-limit'
import { basisOfSchedule } from '@/lib/export/narrative'
import { exportMspXml } from '@/lib/export/msp-xml'
import { exportScheduleCsv } from '@/lib/export/csv'
import { exportXer } from '@/lib/export/xer'
import { encodeXer } from '@/lib/parsers/xer-codec'
import { exportPdf } from '@/lib/export/pdf'
import { exportImportXlsx, exportP6LayoutXlsx } from '@/lib/export/xlsx'
import { calculationSettings, planoraRelease, type Provenance } from '@/lib/export/provenance'
import { scheduleFingerprint } from '@/lib/server/approval'
import { profileFrom } from '@/lib/planning/elicitation'
import { runSra } from '@/lib/planning/sra'
import { loadFirmHistory } from '@/lib/planning/service'
import type { ProjectType } from '@/lib/planning/types'
import { loadPlanContext, planView } from '../context'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Download the schedule:
 *   ?format=xer          Primavera P6 native (.xer)
 *   ?format=xml          MS Project XML
 *   ?format=pdf          PDF schedule report (summary + P6-style Gantt)
 *   ?format=xlsx-p6      Excel laid out like a P6 Gantt (WBS bands, colors, indentation, bars)
 *   ?format=xlsx-import  Excel for importing into MS Project or P6
 *   ?format=csv          flat activity table
 *   ?format=md           Basis of Schedule narrative
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const r = await loadPlanContext(req, params.id, auth)
  const { plan, ctx } = r
  const g = plan.generated
  if (!g) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const format = req.nextUrl.searchParams.get('format') || 'md'
  if (['xer', 'xml', 'pdf', 'xlsx-p6', 'xlsx-import', 'csv', 'md'].includes(format)) {
    requireFeature(ctx.plan, entitlementsFor(ctx.plan).exports.includes(format), `${format.toUpperCase()} export`)
  }
  const slug = plan.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'schedule'
  const teamNotes = Object.entries(plan.answers).filter(([id, a]) => id.startsWith('note.') && a.status === 'known').map(([, a]) => String(a.value))

  // Same rule as the plan page header: Monte Carlo only where the plan has it, else the rule-based estimate.
  const sraFor = async () => g.cpm && entitlementsFor(ctx.plan).sra ? runSra(g, plan.answers, await loadFirmHistory(ctx.orgId, plan.answers['project.type']?.value as ProjectType | undefined)) : undefined
  // A generated plan has no uploaded file: the hash is the SHA-256 of the generated schedule content
  // (the same fingerprint approvals are bound to).
  const prov = (): Provenance => ({
    sources: [{ scheduleName: plan.name, version: `plan version ${plan.version}`, fileName: `Generated in Planora (plan "${plan.name}")`, sha256: scheduleFingerprint(g), dataDate: g.dataDate ?? g.projectStart, progressMode: g.cpm?.progressMode ?? 'retained' }],
    release: planoraRelease(), generatedAt: new Date().toISOString(),
    settings: calculationSettings({ calendars: g.calendars, defaultCalendarId: g.defaultCalendarId }, { progressMode: g.cpm?.progressMode ?? 'retained', mustFinishBy: g.mustFinishBy ?? null, finishMilestone: null }, ctx.settings?.quality),
  })
  let body: string | Buffer | Uint8Array, type: string, file: string
  switch (format) {
    case 'xer':
      // P6 reads XER in Windows-1252; exportXer only emits characters in that range.
      body = encodeXer(exportXer(g, plan.name, { exportedBy: ctx.name })); type = 'application/octet-stream'; file = `${slug}.xer`; break
    case 'xml':
      body = exportMspXml(g, plan.name); type = 'application/xml; charset=utf-8'; file = `${slug}.xml`; break
    case 'csv':
      body = exportScheduleCsv(g); type = 'text/csv; charset=utf-8'; file = `${slug}.csv`; break
    case 'xlsx-import':
      body = await exportImportXlsx(g, plan.name, prov()); type = XLSX; file = `${slug}-import-to-p6-or-ms-project.xlsx`; break
    case 'xlsx-p6':
      body = await exportP6LayoutXlsx(g, plan.name, prov()); type = XLSX; file = `${slug}-p6-layout.xlsx`; break
    case 'pdf': {
      const view = await planView(plan, ctx.orgId)
      body = await exportPdf(g, plan.name, view.evaluation, { preparedBy: ctx.name, sra: await sraFor() }); type = 'application/pdf'; file = `${slug}-schedule.pdf`; break
    }
    case 'md': {
      const view = await planView(plan, ctx.orgId)
      body = basisOfSchedule({ sra: await sraFor(), decisions: plan.decisions, teamNotes, planName: plan.name, profile: profileFrom(plan.answers), schedule: g, evaluation: view.evaluation!, reviews: plan.reviews, generatedBy: ctx.name, aiMode: view.llm.mode })
      type = 'text/markdown; charset=utf-8'; file = `${slug}-basis-of-schedule.md`; break
    }
    default:
      return NextResponse.json({ error: 'Unknown format. Use xer, xml, pdf, xlsx-p6, xlsx-import, csv or md.' }, { status: 400 })
  }
  const rl = await hit(`export:user:${ctx.userId}`, LIMITS.exportsPerUser.limit, LIMITS.exportsPerUser.windowSec)
  if (!rl.ok) throw new ApiError(429, 'Too many exports in the last hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  await audit({ action: 'plan.export', targetType: 'plan', targetId: plan.id, detail: { plan: plan.name, format, file, version: plan.version, activities: g.activities.length } })
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${file}"` } })
})
