import { NextResponse } from 'next/server'
import { publicApi } from '@/lib/server/api'
import { auditQuietly } from '@/lib/server/audit'
import { consumeVerificationToken } from '@/lib/server/email-verification'
import { getUserById } from '@/lib/db'
import { rateLimitedIp } from './limit'

/** Email verification link target: /api/auth/verify?token=… → back to the app with the result. */
export const GET = publicApi(async req => {
  const url = new URL(req.url)
  if (await rateLimitedIp()) return NextResponse.redirect(new URL('/auth?verified=0', url.origin), 303)
  const userId = await consumeVerificationToken(url.searchParams.get('token') || '')
  if (!userId) return NextResponse.redirect(new URL('/auth?verified=0', url.origin), 303)
  const user = await getUserById(userId)
  if (user) await auditQuietly({ orgId: user.orgId, action: 'account.email_verified', targetType: 'user', targetId: user.id, actor: { id: user.id, email: user.email } })
  return NextResponse.redirect(new URL('/dashboard/account?verified=1', url.origin), 303)
}, { csrf: false })
