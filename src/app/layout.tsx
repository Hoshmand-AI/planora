import type { Metadata } from 'next'
import { DM_Sans, DM_Serif_Display } from 'next/font/google'
import './globals.css'

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

export const metadata: Metadata = {
  title: 'Planora — AI Schedule Analysis for Construction',
  description: 'Upload your Primavera P6 or MS Project schedule and get instant AI-powered analysis, delay insights, and executive reports.',
  keywords: 'Planora, construction scheduling, Primavera P6, MS Project, critical path, schedule analysis, AI, CPM',
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
