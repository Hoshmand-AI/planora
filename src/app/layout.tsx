import type { Metadata } from 'next'
import { DM_Sans } from 'next/font/google'
import './globals.css'
import { siteUrl } from '@/lib/site-url'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const title = 'RunF9 — Construction scheduling, explained'
const description = 'Build and check construction schedules with a written basis for every duration and link, the DCMA 14-Point Assessment, and native Primavera P6 and MS Project export.'

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
