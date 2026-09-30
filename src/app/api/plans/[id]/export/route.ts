import { NextRequest, NextResponse } from 'next/server'
import { basisOfSchedule } from '@/lib/export/narrative'
import { exportMspXml } from '@/lib/export/msp-xml'
import { exportScheduleCsv } from '@/lib/export/csv'
import { exportXer } from '@/lib/export/xer'
import { exportPdf } from '@/lib/export/pdf'
import { exportImportXlsx, exportP6LayoutXlsx } from '@/lib/export/xlsx'
import { profileFrom } from '@/lib/planning/elicitation'
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
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadPlanContext(params.id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  const { plan, ctx } = r
  const g = plan.generated
  if (!g) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const format = req.nextUrl.searchParams.get('format') || 'md'
  const slug = plan.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'schedule'
  const teamNotes = Object.entries(plan.answers).filter(([id, a]) => id.startsWith('note.') && a.status === 'known').map(([, a]) => String(a.value))

  let body: string | Buffer | Uint8Array, type: string, file: string
  switch (format) {
    case 'xer':
      // P6 reads XER in Windows-1252; exportXer only emits characters in that range.
      body = Buffer.from(exportXer(g, plan.name, { exportedBy: ctx.name }), 'latin1'); type = 'application/octet-stream'; file = `${slug}.xer`; break
    case 'xml':
      body = exportMspXml(g, plan.name); type = 'application/xml; charset=utf-8'; file = `${slug}.xml`; break
    case 'csv':
      body = exportScheduleCsv(g); type = 'text/csv; charset=utf-8'; file = `${slug}.csv`; break
    case 'xlsx-import':
      body = await exportImportXlsx(g, plan.name); type = XLSX; file = `${slug}-import-to-p6-or-ms-project.xlsx`; break
    case 'xlsx-p6':
      body = await exportP6LayoutXlsx(g, plan.name); type = XLSX; file = `${slug}-p6-layout.xlsx`; break
    case 'pdf': {
      const view = await planView(plan, ctx.orgId)
      body = await exportPdf(g, plan.name, view.evaluation, { preparedBy: ctx.name }); type = 'application/pdf'; file = `${slug}-schedule.pdf`; break
    }
    case 'md': {
      const view = await planView(plan, ctx.orgId)
      body = basisOfSchedule({ teamNotes, planName: plan.name, profile: profileFrom(plan.answers), schedule: g, evaluation: view.evaluation!, reviews: plan.reviews, generatedBy: ctx.name, aiMode: view.llm.mode })
      type = 'text/markdown; charset=utf-8'; file = `${slug}-basis-of-schedule.md`; break
    }
    default:
      return NextResponse.json({ error: 'Unknown format. Use xer, xml, pdf, xlsx-p6, xlsx-import, csv or md.' }, { status: 400 })
  }
  return new NextResponse(body as BodyInit, { headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${file}"` } })
}
