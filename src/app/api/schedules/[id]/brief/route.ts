import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { loadDailyBrief } from '@/lib/server/brief-service'

/**
 * The Daily Brief for one project: what finished and started since the last working day, what starts
 * and finishes today, what is overdue, what drives the finish, the deadline position, risks, issues,
 * open change items, recent changes with their effect, missing scope and logic findings, the day's
 * what-if runs and signals from correspondence, plus a version for the PM, the field and the client.
 * Calculated (no AI call) on the living schedule: the upload with the edits made in RunF9.
 *   GET ?asOf=YYYY-MM-DD (default today) &whatIfActivity=<activity ID>&whatIfDays=<work days>
 */
export const GET = api<{ id: string }>({ permission: 'read', apiKey: true }, async (req, { params, auth }) => {
  const sp = req.nextUrl.searchParams
  const act = (sp.get('whatIfActivity') || '').slice(0, 80), days = Number(sp.get('whatIfDays'))
  const out = await loadDailyBrief(params.id, auth.orgId, { asOf: sp.get('asOf'), whatIf: act && Number.isFinite(days) && days > 0 ? { activity: act, days } : null })
  if (!out) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(out)
})
