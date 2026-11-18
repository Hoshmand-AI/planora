import { api, body as readBody, json, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { MAX_PARTY_ITEMS, parsePartyFields } from '@/lib/analysis/master-schedule'
import { createProgramItem, deleteProgramItem, getProgram, getProgramProject, latestUploadOf, updateProgramItem } from '@/lib/server/programs'

/**
 * What parties other than the contractor owe a program: funding, permits, utilities, design reviews, move-in.
 *   POST    { party, title, projectId?, needDate?, forecastDate?, actualDate?, note?, milestoneKey? }  → { item }
 *   PATCH   ?itemId=…  { any of the fields }  → { item }
 *   DELETE  ?itemId=…  → { ok }
 * `projectId` files the item under one project of the program (omit it for the whole program); `milestoneKey`
 * names the standard milestone the item is needed for. Needs schedule.write; audited. Items are read with the
 * master (GET /api/programs/{id}).
 */
type P = { id: string }

async function checked(orgId: string, programId: string, b: Record<string, unknown>, all: boolean) {
  const program = await getProgram(orgId, programId)
  if (!program) throw new ApiError(404, 'Not found')
  const parsed = parsePartyFields(b, all, program.dictionary)
  if ('error' in parsed) throw new ApiError(400, parsed.error, 'invalid_item')
  if (parsed.fields.projectId) {
    // The project must be in this program and visible to the caller.
    const project = await getProgramProject(orgId, programId, parsed.fields.projectId)
    if (!project || !(await latestUploadOf(orgId, project))) throw new ApiError(400, 'Choose a project of this program.', 'invalid_project')
  }
  return { program, fields: parsed.fields }
}

export const POST = api<P>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const { program, fields } = await checked(auth.orgId, params.id, await readBody(req), true)
  const item = await createProgramItem(auth.orgId, program.id, fields, { userId: auth.userId, name: auth.name })
  if (!item) throw new ApiError(400, `A program holds up to ${MAX_PARTY_ITEMS} items. Delete some first.`, 'items_full')
  await audit({ action: 'program.item_created', targetType: 'program', targetId: program.id, detail: { program: program.name, itemId: item.id, party: item.party, title: item.title, needDate: item.needDate, forecastDate: item.forecastDate } })
  return json({ item })
})

export const PATCH = api<P>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const itemId = req.nextUrl.searchParams.get('itemId') || ''
  const { program, fields } = await checked(auth.orgId, params.id, await readBody(req), false)
  if (!Object.keys(fields).length) throw new ApiError(400, 'Nothing to change.')
  const item = await updateProgramItem(auth.orgId, program.id, itemId, fields)
  if (!item) throw new ApiError(404, 'Not found')
  await audit({ action: 'program.item_updated', targetType: 'program', targetId: program.id, detail: { program: program.name, itemId: item.id, party: item.party, title: item.title, changed: Object.keys(fields), needDate: item.needDate, forecastDate: item.forecastDate, actualDate: item.actualDate } })
  return json({ item })
})

export const DELETE = api<P>({ permission: 'schedule.write' }, async (req, { params, auth }) => {
  const program = await getProgram(auth.orgId, params.id)
  if (!program) throw new ApiError(404, 'Not found')
  const item = await deleteProgramItem(auth.orgId, program.id, req.nextUrl.searchParams.get('itemId') || '')
  if (!item) throw new ApiError(404, 'Not found')
  await audit({ action: 'program.item_deleted', targetType: 'program', targetId: program.id, detail: { program: program.name, itemId: item.id, party: item.party, title: item.title } })
  return json({ ok: true })
})
