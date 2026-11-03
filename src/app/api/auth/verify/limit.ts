import { currentRequest } from '@/lib/server/context'
import { hit } from '@/lib/server/rate-limit'

/** Verification links are guessed-token targets: cap attempts per network. */
export async function rateLimitedIp(): Promise<boolean> {
  const ip = currentRequest()?.ip || 'unknown'
  return !(await hit(`verify:ip:${ip}`, 30, 15 * 60)).ok
}
