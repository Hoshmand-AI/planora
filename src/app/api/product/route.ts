import { publicApi, json } from '@/lib/server/api'
import { productCard } from '@/lib/product-card'

/**
 * RunF9's public product card (src/lib/product-card.ts), read by hoshmand.ai to keep the studio
 * site in step with the product. Public and unauthenticated: it carries only what the landing page
 * already says, and no session is read.
 */
export const GET = publicApi(async () => {
  return json(productCard(), {
    headers: {
      'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=300',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  })
}, { optionalAuth: false })
