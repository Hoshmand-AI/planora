import Landing from '@/components/Landing'
import { accessRequestEmail, signupMode } from '@/lib/server/signup-policy'

// Read the sign-up mode at request time, so changing PLANORA_SIGNUP doesn't need a rebuild.
export const dynamic = 'force-dynamic'

export default function HomePage() {
  return <Landing inviteOnly={signupMode() === 'invite_only'} accessRequestEmail={accessRequestEmail()} />
}
