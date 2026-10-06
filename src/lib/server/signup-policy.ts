// Self sign-up policy. The hosted service lets anyone create an organization. An on-premises or
// air-gapped instance usually must not: with PLANORA_SIGNUP=invite_only, new accounts come only from
// invitations (or single sign-on into a verified domain), except for the very first account on an
// empty instance, which becomes the first organization's owner.

export type SignupMode = 'open' | 'invite_only'

export function signupMode(env: Record<string, string | undefined> = process.env): SignupMode {
  return /^invite[-_]?only$/i.test((env.PLANORA_SIGNUP || '').trim()) ? 'invite_only' : 'open'
}

/** Whether a sign-up WITHOUT an invitation may create a new organization. */
export function selfSignupAllowed(mode: SignupMode, existingOrganizations: number): boolean {
  return mode === 'open' || existingOrganizations === 0
}

export const INVITE_ONLY_MESSAGE = 'This Planora instance accepts new accounts by invitation only. Ask your organization’s admin for an invitation link.'
