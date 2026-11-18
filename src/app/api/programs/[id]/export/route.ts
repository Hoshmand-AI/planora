import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { csvField } from '@/lib/export/csv'
import { fmtDate } from '@/lib/format'
import { isDay, MASTER_REPORTS, reportTable, type MasterReport } from '@/lib/analysis/master-schedule'
import { loadMaster } from '@/lib/server/programs'

/**
 * A master schedule printout as a CSV file.
 *   GET ?report=milestones|phases|sectors|lookahead|parties|updates  [&asOf=YYYY-MM-DD]
 * The first line of every file says which program, the day it was read and how many projects had current data.
 * Text from uploaded schedules cannot run as a spreadsheet formula (csvField). The download is audited.
 */
const TITLES: Record<MasterReport, string> = {
  milestones: 'Milestones', phases: 'Phases', sectors: 'Sectors', lookahead: 'Look-ahead, next 90 days', parties: 'Other parties', updates: 'Contractor updates',
}

export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const sp = req.nextUrl.searchParams
  const report = (sp.get('report') || 'milestones') as MasterReport
  if (!MASTER_REPORTS.includes(report)) throw new ApiError(400, `report must be one of: ${MASTER_REPORTS.join(', ')}.`, 'invalid_report')
  const asOfParam = sp.get('asOf')
  if (asOfParam && !isDay(asOfParam)) throw new ApiError(400, 'asOf must be a date (YYYY-MM-DD).', 'invalid_date')
  const view = await loadMaster(auth.orgId, params.id, asOfParam || new Date().toISOString().slice(0, 10))
  if (!view) throw new ApiError(404, 'Not found')
  const { master, program } = view
  const t = master.totals
  const head = `${program.name}: ${TITLES[report]}. Read ${fmtDate(master.asOf)}. Contractor data current for ${t.byStatus.current} of ${t.projects} projects.`
  const lines = [csvField(head), ...reportTable(master, report, d => (d ? fmtDate(d) : '')).map(r => r.map(csvField).join(','))]
  await audit({ action: 'program.exported', targetType: 'program', targetId: program.id, detail: { program: program.name, report, asOf: master.asOf, projects: t.projects } })
  const slug = program.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'program'
  return new Response(lines.join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slug}-${report}-${master.asOf}.csv"` } })
})
