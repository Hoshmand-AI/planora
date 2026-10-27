import type { Metadata } from 'next'
import { DM_Sans, DM_Serif_Display } from 'next/font/google'
import './globals.css'
import { siteUrl } from '@/lib/site-url'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
})

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif',
  display: 'swap',
})

const title = 'Hoshmand Schedule — Construction scheduling, explained'
const description = 'Build and check construction schedules with a written basis for every duration and link, the DCMA 14-Point Assessment, and native Primavera P6 and MS Project export.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title,
  description,
  applicationName: 'Hoshmand Schedule',
  keywords: 'Hoshmand Schedule, construction scheduling, Primavera P6, MS Project, critical path, schedule analysis, AI, CPM',
  // Link previews when the site is shared in email, Slack, Teams or LinkedIn.
  openGraph: { type: 'website', siteName: 'Hoshmand Schedule', title, description, url: '/' },
  twitter: { card: 'summary_large_image', title, description },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${dmSerifDisplay.variable}`}>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  )
}
