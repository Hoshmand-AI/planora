import { api, body as readBody, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { cleanText } from '@/lib/analysis/master-schedule'
import { createProgram, listPrograms, MAX_PROGRAMS } from '@/lib/server/programs'

/**
 * Programs: several projects read together as one master schedule.
 *   GET            → { programs: [{ id, name, projects }], canEdit }
 *   POST { name }  → { program }   (starts with a standard milestone list the program then edits)
 * Creating needs schedule.write and is audited.
 */
export const GET = api({ permission: 'read', apiKey: true }, async (_req, { auth }) => {
  const programs = await listPrograms(auth.orgId)
  return json({ programs: programs.map(p => ({ id: p.id, name: p.name, projects: p.projects, updatedAt: p.updatedAt })), canEdit: can(auth.role, 'schedule.write') })
})

export const POST = api({ permission: 'schedule.write' }, async (req, { auth }) => {
  const b = await readBody(req)
  const name = cleanText(b.name, 120)
  if (!name || name.length < 2) throw new ApiError(400, 'Give the program a name.', 'invalid_program')
  const program = await createProgram(auth.orgId, name, { userId: auth.userId, name: auth.name })
  if (!program) throw new ApiError(400, `An organization can keep up to ${MAX_PROGRAMS} programs. Delete one first.`, 'programs_full')
  await audit({ action: 'program.created', targetType: 'program', targetId: program.id, detail: { name: program.name } })
  return json({ program })
})
