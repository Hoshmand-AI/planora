import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { projectScope } from '@/lib/rag/scope'
import { registerKey } from '@/lib/server/register'
import { getCaptureMedia } from '@/lib/server/site-captures'

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' }

/**
 * A capture's photo or voice note, to members who can see the project. The type sent is the one the bytes were
 * checked to be when they were stored (never a type from the uploader), with nosniff, so this route cannot serve
 * a page or a script; next.config.js also sends it with a sandboxed, allow-nothing Content-Security-Policy.
 * Byte ranges are answered because phone browsers ask for audio that way.
 */
export const GET = api<{ id: string; captureId: string; mediaId: string }>({ permission: 'read' }, async (req, { params, auth }) => {
  const { schedule } = await projectScope(auth.orgId, params.id)
  const media = await getCaptureMedia(auth.orgId, registerKey(schedule), params.captureId, params.mediaId)
  if (!media) throw new ApiError(404, 'No such photo or voice note in this project.')
  const total = media.bytes.length
  const headers: Record<string, string> = {
    'Content-Type': media.contentType,
    'Content-Disposition': `inline; filename="site-capture-${params.captureId.slice(0, 8)}.${EXT[media.contentType] ?? 'bin'}"`,
    'X-Content-Type-Options': 'nosniff',
    // The bytes of a stored file never change; only a signed-in member's browser may keep them.
    'Cache-Control': 'private, max-age=86400, immutable',
    'Accept-Ranges': 'bytes',
    ETag: `"${media.sha256.slice(0, 32)}"`,
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1
    if (start >= total || start > end) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } })
    const part = media.bytes.subarray(start, end + 1)
    return new NextResponse(new Uint8Array(part), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(part.length) } })
  }
  return new NextResponse(new Uint8Array(media.bytes), { headers: { ...headers, 'Content-Length': String(total) } })
})
