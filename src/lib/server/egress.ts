// One rule for every connection RunF9 opens on its own (AI models, embeddings, webhooks, single
// sign-on, email providers): in an air-gapped install (RUNF9_AIRGAPPED=true) the destination must be
// inside the customer's network: loopback, a private address, a *.internal / *.local / *.lan name,
// or a host the customer listed in RUNF9_ALLOWED_HOSTS. Anything else is refused before connecting.
// scripts/e2e-no-egress.mjs proves it end to end with a network guard.

import { isAllowedAirgapHost } from '@/lib/llm/provider'

type Env = Record<string, string | undefined>

export const airgapped = (env: Env = process.env) => /^(1|true|yes)$/i.test(env.RUNF9_AIRGAPPED || '')

/** Hosts the customer listed as inside their network (RUNF9_ALLOWED_HOSTS, comma-separated). */
export const allowedHosts = (env: Env = process.env) => (env.RUNF9_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

/** Null when RunF9 may connect to this URL; otherwise the reason it may not. */
export function egressProblem(url: string, env: Env = process.env): string | null {
  if (!airgapped(env)) return null
  let host: string
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase() } catch { return 'Invalid URL.' }
  if (isAllowedAirgapHost(host, allowedHosts(env))) return null
  return `This RunF9 is installed air-gapped, so it does not connect to ${host}, which is outside your network. Use a host inside your network or add it to RUNF9_ALLOWED_HOSTS.`
}
