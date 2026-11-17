import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { projectClassification, projectScope } from '@/lib/rag/scope'
import { CLASSIFIED_CLOUD_CODE, classifiedCloudRefusal } from '@/lib/server/classification'
import { deploymentKind } from '@/lib/llm/provider'
import { registerKey } from '@/lib/server/register'
import { getPlanImage } from '@/lib/server/site-plans'

/**
 * A level's drawing, to members who can see the project. The type sent is the one the bytes were checked to be
 * when they were stored, with nosniff; next.config.js also sends it with a sandboxed, allow-nothing policy.
 */
export const GET = api<{ id: string; planId: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id)
  const refusal = classifiedCloudRefusal(await projectClassification(schedule.id, auth.orgId), deploymentKind())
  if (refusal) throw new ApiError(409, refusal, CLASSIFIED_CLOUD_CODE)
  const image = await getPlanImage(auth.orgId, registerKey(schedule), params.planId)
  if (!image) throw new ApiError(404, 'No such drawing in this project.')
  const etag = `"${image.sha256.slice(0, 32)}"`
  const headers: Record<string, string> = {
    'Content-Type': image.contentType,
    'Content-Disposition': `inline; filename="site-plan-${params.planId.slice(0, 8)}.${image.contentType.split('/')[1] === 'jpeg' ? 'jpg' : image.contentType.split('/')[1]}"`,
    'X-Content-Type-Options': 'nosniff',
    // A member's browser may keep the drawing, and asks each time whether it may still show it: a deleted
    // drawing, or a member who has lost access, gets nothing from the browser's own copy.
    'Cache-Control': 'private, no-cache',
    ETag: etag,
  }
  if (req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers })
  return new NextResponse(new Uint8Array(image.bytes), { headers: { ...headers, 'Content-Length': String(image.bytes.length) } })
})
