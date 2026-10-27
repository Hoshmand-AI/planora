// Settings were named PLANORA_* before the RunF9 rename; the code now reads RUNF9_*. Every PLANORA_X
// that is set and has no RUNF9_X counterpart is copied across once, at server start
// (src/instrumentation.ts), so existing deployments (Vercel, on-premises .env files) keep working
// unchanged, including RUNF9_ENCRYPTION_KEY, which must keep its value to read stored secrets.
// A RUNF9_X that is set always wins.

export function applyLegacyEnv(env: Record<string, string | undefined> = process.env): string[] {
  const copied: string[] = []
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('PLANORA_') || value === undefined) continue
    const next = `RUNF9_${key.slice('PLANORA_'.length)}`
    if (env[next] === undefined) { env[next] = value; copied.push(next) }
  }
  return copied
}
