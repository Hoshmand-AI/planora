import { NextResponse } from 'next/server'
import { publicApi } from '@/lib/server/api'
import { safeEqual } from '@/lib/server/crypto'
import { appOrigin } from '@/lib/server/email'
import { sendDueBriefs } from '@/lib/server/brief-digest'

/**
 * Called by the scheduler every working morning (vercel.json). Sends the Daily Brief to its subscribers.
 * Requires the scheduler's secret (CRON_SECRET, sent as a bearer token); without one configured it does
 * nothing, and the hourly housekeeping sends the briefs instead. Idempotent: one email per subscription per day.
 */
export const GET = publicApi(async req => {
  const secret = process.env.CRON_SECRET
  // No secret set: nothing runs from here (the hourly housekeeping sends the briefs). Not an error, so it is not logged as one.
  if (!secret) return NextResponse.json({ configured: false, sent: 0, skipped: 0 })
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!given || !safeEqual(given, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await sendDueBriefs(new Date(), (process.env.APP_URL || appOrigin(req)).replace(/\/+$/, '')))
}, { optionalAuth: false })
