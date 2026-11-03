import { applyLegacyEnv } from '@/lib/legacy-env'

// Runs once when a server instance starts, before any request is handled.
export function register() {
  applyLegacyEnv()
}
