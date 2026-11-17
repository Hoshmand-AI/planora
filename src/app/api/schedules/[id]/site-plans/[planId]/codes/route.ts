import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { audit } from '@/lib/server/audit'
import { appOrigin } from '@/lib/server/email'
import { projectScope } from '@/lib/rag/scope'
import { registerKey } from '@/lib/server/register'
import { getPlan } from '@/lib/server/site-plans'
import { roomCodesPdf } from '@/lib/site/room-codes'

/**
 * The room codes of one level as a PDF to print: one square code per room marked on the drawing. A code holds
 * only a link to this RunF9 (the project, the level and the room's name); opening it still needs a sign-in.
 */
export const GET = api<{ id: string; planId: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id, { metadataOnly: true })
  const plan = await getPlan(auth.orgId, registerKey(schedule), params.planId)
  if (!plan) throw new ApiError(404, 'No such drawing in this project.')
  const pdf = await roomCodesPdf(appOrigin(req), schedule.id, schedule.name, plan)
  await audit({ action: 'site.room_codes_printed', targetType: 'schedule', targetId: schedule.id, detail: { schedule: schedule.name, planId: plan.id, level: plan.level, rooms: plan.rooms.length } })
  return new NextResponse(new Uint8Array(pdf), { headers: {
    'Content-Type': 'application/pdf', 'Content-Length': String(pdf.length), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    'Content-Disposition': `attachment; filename="room-codes-${plan.level.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'level'}.pdf"`,
  } })
})
