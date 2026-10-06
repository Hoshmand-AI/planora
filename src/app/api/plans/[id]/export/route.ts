import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
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
import { profileFrom } from '@/lib/planning/elicitation'
import { runSra } from '@/lib/planning/sra'
import { loadFirmHistory } from '@/lib/planning/service'
import type { ProjectType } from '@/lib/planning/types'
import { loadPlanContext, planView } from '../context'
import { CSV_CUI_REFUSAL, exportMarking, markText, markXer } from '@/lib/export/markings'
import { classificationFromAnswer } from '@/lib/server/classification'

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
  // CUI / classified plans carry markings on every export; CSV cannot carry them and is refused.
  const marking = exportMarking(classificationFromAnswer(plan.answers['security.classification']), { controlledBy: ctx.orgName, poc: ctx.name })
  if (marking && format === 'csv') return NextResponse.json({ error: CSV_CUI_REFUSAL, code: 'cui_csv_excluded' }, { status: 409 })
  const teamNotes = Object.entries(plan.answers).filter(([id, a]) => id.startsWith('note.') && a.status === 'known').map(([, a]) => String(a.value))

  // Same rule as the plan page header: Monte Carlo only where the plan has it, else the rule-based estimate.
  const sraFor = async () => g.cpm && entitlementsFor(ctx.plan).sra ? runSra(g, plan.answers, await loadFirmHistory(ctx.orgId, plan.answers['project.type']?.value as ProjectType | undefined)) : undefined
  let body: string | Buffer | Uint8Array, type: string, file: string
  switch (format) {
    case 'xer':
      // P6 reads XER in Windows-1252; exportXer only emits characters in that range.
      body = encodeXer(markXer(exportXer(g, plan.name, { exportedBy: ctx.name }), marking)); type = 'application/octet-stream'; file = `${slug}.xer`; break
    case 'xml':
      body = exportMspXml(g, plan.name, { marking }); type = 'application/xml; charset=utf-8'; file = `${slug}.xml`; break
    case 'csv':
      body = exportScheduleCsv(g); type = 'text/csv; charset=utf-8'; file = `${slug}.csv`; break
    case 'xlsx-import':
      body = await exportImportXlsx(g, plan.name, { marking }); type = XLSX; file = `${slug}-import-to-p6-or-ms-project.xlsx`; break
    case 'xlsx-p6':
      body = await exportP6LayoutXlsx(g, plan.name, { marking }); type = XLSX; file = `${slug}-p6-layout.xlsx`; break
    case 'pdf': {
      const view = await planView(plan, ctx.orgId)
      body = await exportPdf(g, plan.name, view.evaluation, { preparedBy: ctx.name, sra: await sraFor(), marking }); type = 'application/pdf'; file = `${slug}-schedule.pdf`; break
    }
    case 'md': {
      const view = await planView(plan, ctx.orgId)
      body = markText(basisOfSchedule({ sra: await sraFor(), decisions: plan.decisions, teamNotes, planName: plan.name, profile: profileFrom(plan.answers), schedule: g, evaluation: view.evaluation!, reviews: plan.reviews, generatedBy: ctx.name, aiMode: view.llm.mode }), marking)
      type = 'text/markdown; charset=utf-8'; file = `${slug}-basis-of-schedule.md`; break
    }
    default:
      return NextResponse.json({ error: 'Unknown format. Use xer, xml, pdf, xlsx-p6, xlsx-import, csv or md.' }, { status: 400 })
  }
  const rl = await hit(`export:user:${ctx.userId}`, LIMITS.exportsPerUser.limit, LIMITS.exportsPerUser.windowSec)
  if (!rl.ok) throw new ApiError(429, 'Too many exports in the last hour. Try again later.', 'rate_limited', { retryAfterSec: rl.retryAfterSec })
  await audit({ action: 'plan.export', targetType: 'plan', targetId: plan.id, detail: { plan: plan.name, format, file, version: plan.version, activities: g.activities.length, marking: marking?.banner ?? null, sha256: createHash('sha256').update(body).digest('hex') } })
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${file}"` } })
})
