import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import { siteUrl } from '@/lib/site-url'
import { PRODUCT_NAME, PRODUCT_SUMMARY, PRODUCT_TAGLINE } from '@/lib/product-card'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

// One source with the public product card (/api/product) that hoshmand.ai reads.
const title = `${PRODUCT_NAME} — ${PRODUCT_TAGLINE}`
const description = PRODUCT_SUMMARY

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title,
  description,
  applicationName: 'RunF9',
  keywords: 'RunF9, construction scheduling, Primavera P6, MS Project, critical path, schedule analysis, AI, CPM',
  // Link previews when the site is shared in email, Slack, Teams or LinkedIn.
  openGraph: { type: 'website', siteName: 'RunF9', title, description, url: '/' },
  twitter: { card: 'summary_large_image', title, description },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
