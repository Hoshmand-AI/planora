import { api, body as readBody, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { cleanText, MAX_PROGRAM_PROJECTS } from '@/lib/analysis/master-schedule'
import { addProgramProject, getProgram, projectKeyOfSchedule } from '@/lib/server/programs'
import { getScheduleById } from '@/lib/db'

/**
 * Adds a project to a program.
 *   POST { scheduleId, sector?, location?, contractor? }  → { project }
 * `scheduleId` is any upload of the project; the program follows the project (its update series), so later
 * uploads are picked up without anyone adding them. Needs schedule.write; audited.
 */
export const POST = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const program = await getProgram(auth.orgId, params.id)
  if (!program) throw new ApiError(404, 'Not found')
  const b = await readBody(req)
  const schedule = typeof b.scheduleId === 'string' ? await getScheduleById(b.scheduleId, auth.orgId) : undefined
  const key = schedule ? await projectKeyOfSchedule(auth.orgId, schedule.id) : null
  if (!schedule || !key) throw new ApiError(400, 'Choose one of your projects.', 'invalid_project')
  const added = await addProgramProject(auth.orgId, program.id, { projectKey: key, sector: cleanText(b.sector, 60), location: cleanText(b.location, 80), contractor: cleanText(b.contractor, 120) })
  if (added === 'exists') throw new ApiError(409, 'That project is already in this program.', 'project_in_program')
  if (added === 'full') throw new ApiError(400, `A program can hold up to ${MAX_PROGRAM_PROJECTS} projects.`, 'program_full')
  await audit({ action: 'program.project_added', targetType: 'program', targetId: program.id, detail: { program: program.name, project: schedule.name, sector: added.sector, contractor: added.contractor } })
  return json({ project: added })
})
