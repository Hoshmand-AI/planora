import { randomUUID } from 'crypto'
import { api, body as readBody, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { can } from '@/lib/server/permissions'
import { cleanText, isDay, lookAhead, parseDictionary } from '@/lib/analysis/master-schedule'
import { availableProjects, deleteProgram, getProgram, loadMaster, updateProgram } from '@/lib/server/programs'

/**
 * One program's master schedule.
 *   GET    ?asOf=YYYY-MM-DD  → { program, master, lookAhead, projects, available, canEdit }
 *          Every contractor date in `master` is read from the project's newest upload by activity ID; nothing
 *          about a contractor date is stored here. `asOf` (today when omitted) only sets how old each project's
 *          data is counted to be.
 *   PATCH  { name?, milestones?: [{ key?, name, phase }] }  → { program }
 *   DELETE → { ok }   (the projects' schedules are untouched)
 * Changing needs schedule.write and is audited.
 */
const today = () => new Date().toISOString().slice(0, 10)

export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const asOfParam = req.nextUrl.searchParams.get('asOf')
  if (asOfParam && !isDay(asOfParam)) throw new ApiError(400, 'asOf must be a date (YYYY-MM-DD).', 'invalid_date')
  const view = await loadMaster(auth.orgId, params.id, asOfParam || today())
  if (!view) throw new ApiError(404, 'Not found')
  const canEdit = can(auth.role, 'schedule.write')
  return json({ program: view.program, master: view.master, lookAhead: lookAhead(view.master), projects: view.projects,
    available: canEdit ? await availableProjects(auth.orgId, params.id) : [], canEdit })
})

export const PATCH = api<{ id: string }>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const before = await getProgram(auth.orgId, params.id)
  if (!before) throw new ApiError(404, 'Not found')
  const b = await readBody(req)
  const patch: { name?: string; dictionary?: typeof before.dictionary } = {}
  if (b.name !== undefined) {
    const name = cleanText(b.name, 120)
    if (!name || name.length < 2) throw new ApiError(400, 'Give the program a name.', 'invalid_program')
    patch.name = name
  }
  if (b.milestones !== undefined) {
    const parsed = parseDictionary(b.milestones, () => `m_${randomUUID().slice(0, 8)}`)
    if ('error' in parsed) throw new ApiError(400, parsed.error, 'invalid_milestones')
    patch.dictionary = parsed.dictionary
  }
  if (patch.name === undefined && patch.dictionary === undefined) throw new ApiError(400, 'Nothing to change.')
  const program = await updateProgram(auth.orgId, params.id, patch)
  if (!program) throw new ApiError(404, 'Not found')
  await audit({ action: 'program.updated', targetType: 'program', targetId: program.id, detail: {
    name: program.name, renamedFrom: patch.name && patch.name !== before.name ? before.name : undefined,
    milestones: patch.dictionary ? { before: before.dictionary.map(m => m.name), after: program.dictionary.map(m => m.name) } : undefined,
  } })
  return json({ program })
})

export const DELETE = api<{ id: string }>({ permission: 'schedule.write' }, async (_req, { params, auth }) => {
  const before = await getProgram(auth.orgId, params.id)
  if (!before || !(await deleteProgram(auth.orgId, params.id))) throw new ApiError(404, 'Not found')
  await audit({ action: 'program.deleted', targetType: 'program', targetId: before.id, detail: { name: before.name } })
  return json({ ok: true })
})
