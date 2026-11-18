import { api, json, ApiError } from '@/lib/server/api'
import { readDate } from '@/lib/analysis/master-schedule'
import { getProgram, getProgramProject, latestUploadOf, searchActivities } from '@/lib/server/programs'

/**
 * Activities of a program project's newest upload, to choose the one a standard milestone reads.
 *   GET ?q=text  → { upload: { version, dataDate }, activities: [{ code, name, type, start, finish }] }
 * Milestone activities come first. Up to 40 are returned; narrow the search to find others.
 */
export const GET = api<{ id: string; projectId: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const program = await getProgram(auth.orgId, params.id)
  const project = program ? await getProgramProject(auth.orgId, params.id, params.projectId) : undefined
  if (!program || !project) throw new ApiError(404, 'Not found')
  const latest = await latestUploadOf(auth.orgId, project)
  if (!latest) return json({ upload: null, activities: [] })
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80)
  const acts = await searchActivities(auth.orgId, latest.id, q)
  return json({ upload: { version: latest.version, dataDate: latest.dataDate }, activities: acts.map(a => ({
    code: a.code, name: a.name, type: a.type, milestoneKind: a.milestoneKind ?? null, start: readDate(a, 'start').date, finish: readDate(a, 'finish').date,
  })) })
})
