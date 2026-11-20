import { api, body as readBody, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { cleanText, MAX_PROGRAM_PROJECTS } from '@/lib/analysis/master-schedule'
import { buildProgramFromSchedules, createProgram, listPrograms, MAX_PROGRAMS } from '@/lib/server/programs'

/**
 * Programs: several projects read together as one master schedule.
 *   GET            → { programs: [{ id, name, projects }], canEdit }
 *   POST { name, scheduleIds? }  → { program, projects? }
 *        With scheduleIds (any upload of each project) the master is built from those schedules: its standard
 *        milestones come from the milestones the schedules share, each project is added, and every milestone that
 *        matches an activity by name is pointed at it. Without them it starts empty with a standard list.
 * Creating needs schedule.write and is audited.
 */
export const GET = api({ permission: 'read', apiKey: true }, async (_req, { auth }) => {
  const programs = await listPrograms(auth.orgId)
  return json({ programs: programs.map(p => ({ id: p.id, name: p.name, projects: p.projects, updatedAt: p.updatedAt })), canEdit: can(auth.role, 'schedule.write') })
})

export const POST = api({ permission: 'schedule.write' }, async (req, { auth }) => {
  const b = await readBody(req)
  const name = cleanText(b.name, 120)
  if (!name || name.length < 2) throw new ApiError(400, 'Give the master schedule a name.', 'invalid_program')
  const by = { userId: auth.userId, name: auth.name }
  if (b.scheduleIds !== undefined) {
    const ids = Array.isArray(b.scheduleIds) ? [...new Set(b.scheduleIds.filter((x): x is string => typeof x === 'string' && !!x))] : []
    if (!ids.length) throw new ApiError(400, 'Choose at least one schedule.', 'invalid_project')
    if (ids.length > MAX_PROGRAM_PROJECTS) throw new ApiError(400, `A master schedule can hold up to ${MAX_PROGRAM_PROJECTS} projects.`, 'program_full')
    const built = await buildProgramFromSchedules(auth.orgId, name, ids, by)
    if (built === 'none') throw new ApiError(400, 'Choose one of your projects.', 'invalid_project')
    if (!built) throw new ApiError(400, `An organization can keep up to ${MAX_PROGRAMS} master schedules. Delete one first.`, 'programs_full')
    await audit({ action: 'program.created', targetType: 'program', targetId: built.program.id, detail: {
      name: built.program.name, builtFrom: built.projects.map(p => p.name), milestones: built.program.dictionary.map(m => m.name), mapped: built.projects.reduce((n, p) => n + p.mapped, 0) } })
    return json({ program: built.program, projects: built.projects })
  }
  const program = await createProgram(auth.orgId, name, by)
  if (!program) throw new ApiError(400, `An organization can keep up to ${MAX_PROGRAMS} master schedules. Delete one first.`, 'programs_full')
  await audit({ action: 'program.created', targetType: 'program', targetId: program.id, detail: { name: program.name } })
  return json({ program })
})
