// Per-request context (request id, client, authenticated actor) carried through async calls so
// logging and audit records can attribute every action without threading arguments everywhere.

import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestInfo {
  requestId: string
  method: string
  path: string
  ip: string | null
  userAgent: string | null
  userId?: string
  email?: string
  name?: string
  orgId?: string
  role?: string
  /** Organization policy: AI features allowed, and daily request quota */
  aiEnabled?: boolean
  aiDailyLimit?: number
  plan?: string
  /**
   * Security classification of the project data this request works on ('cui', 'classified',
   * 'unclassified', or null when unknown / not project-scoped). Resolved lazily, once, by the model
   * provider before anything is sent to a model outside the customer's network.
   */
  dataClassification?: () => Promise<string | null>
}

const storage = new AsyncLocalStorage<RequestInfo>()

export const runWithRequest = <T>(info: RequestInfo, fn: () => Promise<T>) => storage.run(info, fn)
export const currentRequest = (): RequestInfo | undefined => storage.getStore()

export function clientIp(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || null
  return headers.get('x-real-ip')
}
