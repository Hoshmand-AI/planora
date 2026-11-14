import { runf9Release } from '@/lib/export/provenance'
import { siteUrl } from '@/lib/site-url'

/**
 * RunF9's public product card: how the product describes itself to the outside world.
 *
 * hoshmand.ai (the studio site) reads GET /api/product about once a minute and shows exactly this:
 * the name, the logo, what RunF9 does, whether it is open, and what changed recently. The page
 * metadata in src/app/layout.tsx reads the same constants, so renaming RunF9 or rewording the
 * tagline here changes the app and the studio site together.
 *
 * Keep it public-safe: no customer names, no figures that are not on the landing page, nothing
 * from a customer's data. When a pull request ships something a customer would notice, add one
 * line to UPDATES (newest first). Format: docs/PRODUCT-CARD.md in Hoshmand-AI/hoshmand-ai.
 */

export const PRODUCT_NAME = 'RunF9'
export const PRODUCT_TAGLINE = 'Construction scheduling, explained'
export const PRODUCT_SUMMARY =
  'Build and check construction schedules with a written basis for every duration and link, the DCMA 14-Point Assessment, and native Primavera P6 and MS Project export.'

export interface ProductUpdate {
  /** YYYY-MM-DD, the day it shipped. */
  date: string
  title: string
}

/** Newest first. Shown on hoshmand.ai under "What's new"; the latest few are enough. */
export const UPDATES: ProductUpdate[] = [
  { date: '2026-11-14', title: 'On a phone, the schedule is a list with each activity’s dates and float' },
  { date: '2026-11-14', title: 'Daily Brief in five short tabs: what to act on now, then the detail behind it' },
  { date: '2026-11-14', title: 'Schedule: start, finish and float columns beside the bars, with the baseline drawn under each' },
  { date: '2026-11-14', title: 'One look for buttons, tabs and form fields across the app' },
  { date: '2026-11-14', title: 'Organization settings in five short tabs; project documents open on the library' },
  { date: '2026-11-14', title: 'Easier on phones: larger text and buttons, and a shorter project header' },
  { date: '2026-11-14', title: 'Daily Brief: what needs action comes first, with the detail one tap away' },
  { date: '2026-11-13', title: 'A new landing page with real product screens' },
  { date: '2026-11-12', title: 'Project mailbox: read one Microsoft 365 mail folder per project' },
  { date: '2026-11-11', title: 'Contract watch explains a clause right where you read it' },
  { date: '2026-11-11', title: 'MS Project updates follow each task when rows are renumbered' },
  { date: '2026-11-10', title: 'Daily Brief: the schedule, field reports, drawings and contract checked every morning' },
  { date: '2026-11-10', title: 'Project inbox: emails, transcripts and daily reports arrive on their own' },
  { date: '2026-11-10', title: 'IPMDAR Schedule Performance Dataset export' },
  { date: '2026-11-05', title: 'Edit a schedule in plain English, with preview and undo' },
  { date: '2026-11-05', title: 'Draft a time-impact fragnet from a change document, every activity cited' },
  { date: '2026-11-05', title: 'New RunF9 name and logo (formerly Planora)' },
]

export const HIGHLIGHTS = [
  'Press F9 and get a finish date you can defend: every duration and link has a written basis',
  'DCMA 14-Point Assessment on any Primavera P6 or MS Project schedule, in seconds',
  'Native P6 and MS Project export, so the schedule goes back into the tools your team uses',
  'A Daily Brief each morning that checks field reports, drawings and the contract against the schedule',
  'Edit a schedule in plain English, with a preview and undo',
  'Reports drafted from the schedule\'s calculated figures, for you to review before sending',
]

/** First line of a commit message, skipping GitHub's "Merge pull request #n from ..." line. */
export function releaseNote(message: string | undefined): string | undefined {
  if (!message) return undefined
  const lines = message.split('\n').map(l => l.trim()).filter(Boolean)
  const line = /^Merge (pull request|branch)\b/.test(lines[0] ?? '') ? lines[1] : lines[0]
  return line ? line.slice(0, 160) : undefined
}

/** Inlined at build time by next.config.js (env.RUNF9_BUILT_AT). */
const BUILT_AT = process.env.RUNF9_BUILT_AT

export function productCard(env: Record<string, string | undefined> = process.env) {
  return {
    schema: 'hoshmand.product/1',
    id: 'runf9',
    name: PRODUCT_NAME,
    formerNames: ['Planora'],
    tagline: PRODUCT_TAGLINE,
    summary: PRODUCT_SUMMARY,
    // Where people open RunF9. Moves with APP_URL, so a new domain reaches hoshmand.ai too.
    url: siteUrl(env),
    status: 'beta',
    access: 'invite-only',
    accessNote: 'Private beta · by invitation',
    // Paths on this origin; the reader resolves them against the card's own address.
    logo: { mark: '/brand/runf9-mark.svg', wordmarkLight: '/brand/runf9-logo-light.svg', wordmarkDark: '/brand/runf9-logo-dark.svg' },
    highlights: HIGHLIGHTS,
    updates: UPDATES.slice(0, 8),
    release: {
      id: runf9Release(env),
      note: releaseNote(env.VERCEL_GIT_COMMIT_MESSAGE),
      builtAt: env.RUNF9_BUILT_AT || BUILT_AT || undefined,
    },
  }
}
