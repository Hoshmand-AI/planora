import { api, body as readBody, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { cleanText, parseMapping, parseOwnerForecasts, suggestMapping } from '@/lib/analysis/master-schedule'
import { getProgram, getProgramProject, latestUploadOf, milestoneActivities, removeProgramProject, updateProgramProject } from '@/lib/server/programs'

/**
 * One project inside a program.
 *   GET     → { suggestions }  for the standard milestones not mapped yet: the milestone activity of the newest
 *             upload whose name is closest. Nothing is mapped until a person accepts one.
 *   PATCH   { sector?, location?, contractor?,
 *             mapping?: { [milestoneKey]: { code, use: 'start' | 'finish' } | null },
 *             ownerForecasts?: { [milestoneKey]: { date, note? } | null } }  → { project }
 *             `mapping` names the contractor activity a standard milestone reads; the date itself is never sent
 *             or stored. `ownerForecasts` is what the owner expects instead, shown beside the contractor's date.
 *   DELETE  → { ok }  takes the project out of the program; its schedules are untouched.
 * Changing needs schedule.write and is audited.
 */
type P = { id: string; projectId: string }

async function load(orgId: string, p: P) {
  const program = await getProgram(orgId, p.id)
  const project = program ? await getProgramProject(orgId, p.id, p.projectId) : undefined
  if (!program || !project) throw new ApiError(404, 'Not found')
  // A project behind a workspace wall is not found for someone outside it.
  const latest = await latestUploadOf(orgId, project)
  return { program, project, latest }
}

export const GET = api<P>({ permission: 'read' }, async (_req, { params, auth }) => {
  const { program, project, latest } = await load(auth.orgId, params)
  if (!latest) return json({ suggestions: {} })
  return json({ suggestions: suggestMapping(program.dictionary, await milestoneActivities(auth.orgId, latest.id), project.mapping) })
})

export const PATCH = api<P>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { program, project, latest } = await load(auth.orgId, params)
  const b = await readBody(req)
  const patch: Parameters<typeof updateProgramProject>[3] = {}
  if (b.sector !== undefined) patch.sector = cleanText(b.sector, 60)
  if (b.location !== undefined) patch.location = cleanText(b.location, 80)
  if (b.contractor !== undefined) patch.contractor = cleanText(b.contractor, 120)
  if (b.mapping !== undefined) {
    const parsed = parseMapping(b.mapping, program.dictionary, project.mapping)
    if ('error' in parsed) throw new ApiError(400, parsed.error, 'invalid_mapping')
    patch.mapping = parsed.mapping
  }
  if (b.ownerForecasts !== undefined) {
    const parsed = parseOwnerForecasts(b.ownerForecasts, program.dictionary, project.ownerForecasts, null, new Date().toISOString())
    if ('error' in parsed) throw new ApiError(400, parsed.error, 'invalid_forecast')
    patch.ownerForecasts = parsed.ownerForecasts
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'Nothing to change.')
  const next = await updateProgramProject(auth.orgId, program.id, project.id, patch)
  if (!next) throw new ApiError(404, 'Not found')
  const nameOf = (k: string) => program.dictionary.find(m => m.key === k)?.name ?? k
  const changed = <T,>(a: Record<string, T>, c: Record<string, T>) => [...new Set([...Object.keys(a), ...Object.keys(c)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(c[k]))
  await audit({ action: 'program.project_updated', targetType: 'program', targetId: program.id, detail: {
    program: program.name, project: latest?.name ?? project.projectKey,
    sector: patch.sector !== undefined ? next.sector : undefined, location: patch.location !== undefined ? next.location : undefined, contractor: patch.contractor !== undefined ? next.contractor : undefined,
    mapping: patch.mapping ? changed(project.mapping, next.mapping).map(k => ({ milestone: nameOf(k), activity: next.mapping[k]?.code ?? null, reads: next.mapping[k]?.use ?? null })) : undefined,
    ownerForecasts: patch.ownerForecasts ? changed(project.ownerForecasts, next.ownerForecasts).map(k => ({ milestone: nameOf(k), date: next.ownerForecasts[k]?.date ?? null })) : undefined,
  } })
  return json({ project: next })
})

export const DELETE = api<P>({ permission: 'schedule.write' }, async (_req, { params, auth }) => {
  const { program, project, latest } = await load(auth.orgId, params)
  if (!(await removeProgramProject(auth.orgId, program.id, project.id))) throw new ApiError(404, 'Not found')
  await audit({ action: 'program.project_removed', targetType: 'program', targetId: program.id, detail: { program: program.name, project: latest?.name ?? project.projectKey } })
  return json({ ok: true })
})
