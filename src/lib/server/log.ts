// Structured JSON logs (one line per event) with the request id, so platform logs can be searched,
// correlated and alerted on. Secrets are redacted by key name.

import { currentRequest } from './context'

type Level = 'debug' | 'info' | 'warn' | 'error'
const SECRET_KEY = /pass(word)?|secret|token|authorization|cookie|api[_-]?key|mfa|code$/i

function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v == null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.slice(0, 50).map(x => redact(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(x, depth + 1)
  return out
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (level === 'debug' && !process.env.PLANORA_DEBUG) return
  const r = currentRequest()
  const line = {
    ts: new Date().toISOString(), level, msg,
    ...(r ? { requestId: r.requestId, method: r.method, path: r.path, userId: r.userId, orgId: r.orgId } : {}),
    ...(redact(fields) as Record<string, unknown>),
  }
  const text = JSON.stringify(line)
  if (level === 'error') console.error(text)
  else if (level === 'warn') console.warn(text)
  else console.log(text)
}

export const errorFields = (err: unknown) => err instanceof Error ? { error: err.message, stack: err.stack?.split('\n').slice(0, 6).join(' | ') } : { error: String(err) }
