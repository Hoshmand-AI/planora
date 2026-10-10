// Self sign-up policy. With PLANORA_SIGNUP=invite_only, new accounts come only from invitations (or
// single sign-on into a verified domain), except for the very first account on an empty instance,
// which becomes the first organization's owner. The hosted service on Vercel is in an invite-only
// beta, so it defaults to invite_only there; PLANORA_SIGNUP=open reopens it. Elsewhere (local,
// on-premises) the default stays open.

export type SignupMode = 'open' | 'invite_only'

export function signupMode(env: Record<string, string | undefined> = process.env): SignupMode {
  const setting = (env.PLANORA_SIGNUP || '').trim()
  if (/^invite[-_]?only$/i.test(setting)) return 'invite_only'
  if (/^open$/i.test(setting)) return 'open'
  return env.VERCEL === '1' ? 'invite_only' : 'open'
}

/** Whether a sign-up WITHOUT an invitation may create a new organization. */
export function selfSignupAllowed(mode: SignupMode, existingOrganizations: number): boolean {
  return mode === 'open' || existingOrganizations === 0
}

export const INVITE_ONLY_MESSAGE = 'This Planora instance accepts new accounts by invitation only. Ask your organization’s admin for an invitation link.'
