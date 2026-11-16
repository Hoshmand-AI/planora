// Today is now part of the project Overview: one page answers "will we finish on time, and what needs me today?".
// Old links and bookmarks land there, keeping the project they pointed at.

import { redirect } from 'next/navigation'

export default async function TodayRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) q.append(k, x)
  redirect(`/dashboard/project${q.size ? `?${q}` : ''}`)
}
