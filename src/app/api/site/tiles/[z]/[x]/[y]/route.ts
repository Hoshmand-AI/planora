import { NextResponse } from 'next/server'
import { api, ApiError } from '@/lib/server/api'
import { egressProblem } from '@/lib/server/egress'
import { hit } from '@/lib/server/rate-limit'
import { sniffMedia } from '@/lib/site/capture'
import { imagery, tileUrl } from '@/lib/site/imagery'
import { validTile } from '@/lib/site/plan'

/**
 * One square of the aerial picture shown under a site plan. RunF9's server fetches it from the configured source
 * (see src/lib/site/imagery.ts) and passes it on, so the member's browser talks only to RunF9. The request sent
 * to the source carries the square's numbers and nothing about the member, the organization or the project.
 * Off on an air-gapped deployment and when RUNF9_SITE_IMAGERY=off.
 */
const TILES_PER_USER_PER_HOUR = 6000
const MAX_TILE_BYTES = 1024 * 1024

export const GET = api<{ z: string; x: string; y: string }>({ permission: 'read' }, async (_req, { params, auth }) => {
  const im = imagery()
  if (!im) throw new ApiError(404, 'The aerial picture is turned off on this deployment.', 'imagery_off')
  const z = Number(params.z), x = Number(params.x), y = Number(params.y.replace(/\.(png|jpe?g|webp)$/i, ''))
  if (!validTile(z, x, y) || z > im.maxZoom) throw new ApiError(404, 'No such map square.')
  const quota = await hit(`tiles:user:${auth.userId}`, TILES_PER_USER_PER_HOUR, 3600)
  if (!quota.ok) throw new ApiError(429, 'Too many map squares asked for this hour. Try again later.', 'rate_limited', { retryAfterSec: quota.retryAfterSec })
  const url = tileUrl(im, z, x, y)
  const blocked = egressProblem(url)
  if (blocked) throw new ApiError(404, 'The aerial picture is not reachable from this deployment.', 'imagery_off')
  let res: Response
  try { res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { Accept: 'image/*', 'User-Agent': 'RunF9' } }) }
  catch { throw new ApiError(502, 'The aerial picture could not be fetched.', 'imagery_unavailable') }
  if (res.status === 404) throw new ApiError(404, 'No picture for this map square.')
  if (!res.ok) throw new ApiError(502, 'The aerial picture could not be fetched.', 'imagery_unavailable')
  if (Number(res.headers.get('content-length') || 0) > MAX_TILE_BYTES) throw new ApiError(502, 'The aerial picture could not be fetched.', 'imagery_unavailable')
  // Read up to the limit and no further, whatever length the source declared (or did not).
  const parts: Uint8Array[] = []
  let size = 0
  const reader = res.body?.getReader()
  if (!reader) throw new ApiError(502, 'The aerial picture could not be fetched.', 'imagery_unavailable')
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_TILE_BYTES) { await reader.cancel().catch(() => {}); throw new ApiError(502, 'The aerial picture could not be fetched.', 'imagery_unavailable') }
    parts.push(value)
  }
  const bytes = Buffer.concat(parts)
  // Passed on only when the bytes are a picture: the source can never make this route serve a page or a script.
  const sniffed = sniffMedia(bytes)
  if (!sniffed || sniffed.kind !== 'photo') throw new ApiError(502, 'The aerial picture could not be fetched.', 'imagery_unavailable')
  return new NextResponse(new Uint8Array(bytes), { headers: {
    'Content-Type': sniffed.contentType, 'Content-Length': String(bytes.length), 'X-Content-Type-Options': 'nosniff',
    // An aerial picture changes rarely; a signed-in member's browser may keep a square for a week.
    'Cache-Control': 'private, max-age=604800',
  } })
})
