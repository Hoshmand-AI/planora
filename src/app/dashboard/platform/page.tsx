import { notFound } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/server/signup-policy'
import { BetaAdmin } from '@/components/BetaAdmin'

// Private beta administration. Only platform operators (PLANORA_PLATFORM_ADMINS) get this page;
// everyone else gets a 404, as from /api/platform/beta.
export const dynamic = 'force-dynamic'

export default async function PlatformPage() {
  const auth = await getAuthContext().catch(() => null)
  if (!auth || !isPlatformAdmin(auth.email)) notFound()
  return <BetaAdmin />
}
