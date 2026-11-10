import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { loadChangeImpact } from '@/lib/server/change-impact'

/** GET: what changed in RunF9 in the last 7 days and which activities moved because of it (for highlighting). */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (_req, { params, auth }) => {
  const impact = await loadChangeImpact(params.id, auth.orgId)
  if (!impact) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
  return NextResponse.json(impact)
})
