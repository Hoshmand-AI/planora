import { NextResponse } from 'next/server'
import { publicApi } from '@/lib/server/api'
import { safeEqual } from '@/lib/server/crypto'
import { appOrigin } from '@/lib/server/email'
import { sendDueBriefs } from '@/lib/server/brief-digest'
import { initSchema, query } from '@/lib/db'
import { syncDueMailboxes } from '@/lib/server/project-mailbox'
import { log } from '@/lib/server/log'

/** Connected project mailboxes are read first, so the morning brief includes yesterday's emails. A failure here never stops the brief. */
const readMailboxes = async () => { try { await syncDueMailboxes() } catch (e) { log('error', 'mailbox sync pass failed', { error: (e as Error).message }) } }

/**
 * Called by the scheduler every working morning (vercel.json). Sends the Daily Brief to its subscribers.
 * Idempotent: one email per subscription per day, and never before the morning hour.
 *
 * With CRON_SECRET set, the caller must present it as a bearer token. Without one, the endpoint still
 * does its job, so a deployment needs no extra setting for the morning email: a call can only start
 * the send that is already due, at most once every ten minutes, and the answer says nothing about it.
 */
export const GET = publicApi(async req => {
  const secret = process.env.CRON_SECRET
  const origin = (process.env.APP_URL || appOrigin(req)).replace(/\/+$/, '')
  if (!secret) {
    await initSchema()
    const claim = await query(`INSERT INTO maintenance_runs (name, last_run_at) VALUES ('daily-brief', NOW())
      ON CONFLICT (name) DO UPDATE SET last_run_at = NOW() WHERE maintenance_runs.last_run_at < NOW() - INTERVAL '10 minutes'
      RETURNING last_run_at`)
    if (claim.rowCount) { await readMailboxes(); await sendDueBriefs(new Date(), origin) }
    return NextResponse.json({ ok: true })
  }
  const given = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!given || !safeEqual(given, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await readMailboxes()
  return NextResponse.json(await sendDueBriefs(new Date(), origin))
}, { optionalAuth: false })
