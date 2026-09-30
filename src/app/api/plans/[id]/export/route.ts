import { NextRequest, NextResponse } from 'next/server'
import { basisOfSchedule } from '@/lib/export/narrative'
import { exportMspXml } from '@/lib/export/msp-xml'
import { exportScheduleCsv } from '@/lib/export/csv'
import { profileFrom } from '@/lib/planning/elicitation'
import { loadPlanContext, planView } from '../context'

/** Download the schedule: ?format=md (Basis of Schedule narrative) | xml (MS Project) | csv */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await loadPlanContext(params.id)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status })
  const { plan, ctx } = r
  if (!plan.generated) return NextResponse.json({ error: 'Generate the schedule first.' }, { status: 400 })
  const format = req.nextUrl.searchParams.get('format') || 'md'
  const slug = plan.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'schedule'
  let body: string, type: string, ext: string
  if (format === 'xml') {
    body = exportMspXml(plan.generated, plan.name); type = 'application/xml'; ext = 'xml'
  } else if (format === 'csv') {
    body = exportScheduleCsv(plan.generated); type = 'text/csv'; ext = 'csv'
  } else {
    const view = await planView(plan, ctx.orgId)
    body = basisOfSchedule({ planName: plan.name, profile: profileFrom(plan.answers), schedule: plan.generated, evaluation: view.evaluation!, reviews: plan.reviews, generatedBy: ctx.name, aiMode: view.llm.mode })
    type = 'text/markdown'; ext = 'md'
  }
  return new NextResponse(body, {
    headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${slug}${format === 'md' ? '-basis-of-schedule' : ''}.${ext}"` },
  })
}
