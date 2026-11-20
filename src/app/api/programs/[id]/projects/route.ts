import { api, body as readBody, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { cleanText, MAX_PROGRAM_PROJECTS } from '@/lib/analysis/master-schedule'
import { addProjectWithMapping, getProgram } from '@/lib/server/programs'

/**
 * Adds a project to a program.
 *   POST { scheduleId, sector?, location?, contractor? }  → { project }
 * `scheduleId` is any upload of the project; the program follows the project (its update series), so later
 * uploads are picked up without anyone adding them. Milestones whose names match an activity of the newest upload
 * are pointed at it straight away (`mapped` says how many); the rest are mapped by hand. Needs schedule.write; audited.
 */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const program = await getProgram(auth.orgId, params.id)
  if (!program) throw new ApiError(404, 'Not found')
  const b = await readBody(req)
  const added = typeof b.scheduleId === 'string'
    ? await addProjectWithMapping(auth.orgId, program, b.scheduleId, { sector: cleanText(b.sector, 60), location: cleanText(b.location, 80), contractor: cleanText(b.contractor, 120) })
    : 'unknown'
  if (added === 'unknown') throw new ApiError(400, 'Choose one of your projects.', 'invalid_project')
  if (added === 'exists') throw new ApiError(409, 'That project is already in this master schedule.', 'project_in_program')
  if (added === 'full') throw new ApiError(400, `A master schedule can hold up to ${MAX_PROGRAM_PROJECTS} projects.`, 'program_full')
  await audit({ action: 'program.project_added', targetType: 'program', targetId: program.id, detail: { program: program.name, project: added.name, sector: added.project.sector, contractor: added.project.contractor, milestonesMapped: added.mapped } })
  return json({ project: added.project, mapped: added.mapped })
})
