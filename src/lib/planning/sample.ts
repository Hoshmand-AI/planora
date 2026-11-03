// A ready-made sample project for first-time users: a three-story medical office building with
// realistic answers, a generated schedule and a required date it misses by a few weeks, so the
// interview, quality checks, recovery options (with costs) and risk analysis all have something to
// show. Everything is labelled as a sample.

import type { Answer, AnswerValue, GeneratedSchedule } from './types'
import { generateSchedule } from './generator'
import { elicit } from './elicitation'

export const SAMPLE_NAME = 'Sample: Riverside Medical Office Building'

const k = (value: AnswerValue, at: string, note?: string): Answer => ({ status: 'known', value, answeredAt: at, source: 'user', ...(note ? { note } : {}) })

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** First Monday at least 30 days after today. */
function nextNtp(today: string): string {
  let d = addDays(today, 30)
  while (new Date(d + 'T00:00:00Z').getUTCDay() !== 1) d = addDays(d, 1)
  return d
}

export function sampleProject(today = new Date().toISOString().slice(0, 10)): { answers: Record<string, Answer>; generated: GeneratedSchedule } {
  const at = new Date().toISOString()
  const answers: Record<string, Answer> = {
    'project.type': k('healthcare', at),
    'project.state': k('VA', at),
    'project.city': k('Fairfax County', at),
    'project.scope': k('new_construction', at),
    'project.gross_sqft': k(60000, at),
    'project.stories': k(3, at),
    'project.target_start': k(nextNtp(today), at),
    'project.delivery': k('dbb', at),
    'design.drawings': k(true, at),
    'design.percent': k(90, at, 'Sample: 90% construction documents; owner review of the final set pending.'),
    'project.federal': k(false, at),
    'site.acres_disturbed': k(4, at),
    'site.conditions': k('previously_developed', at),
    'calendar.workweek': k('5x8', at),
    'calendar.holidays': k(true, at),
    'calendar.weather': k(true, at),
    'cost.labor_per_day': k(18000, at),
    'cost.delay_per_day': k(12000, at),
  }
  // Permits, long-lead items and regulations depend on the answers above: take the typical case
  // for each, as a team that has done its homework would.
  for (const q of elicit({ answers }, { today }).questions) {
    if (q.fallback && q.section !== 'milestones' && q.section !== 'history') answers[q.id] = k(q.fallback.value, at)
  }
  // Set the required completion a few weeks before what the logic supports, so recovery is shown.
  const first = generateSchedule({ answers, today })
  const finish = first.cpm?.projectFinish
  if (finish) answers['project.required_finish'] = k(addDays(finish, -42), at, 'Sample: owner occupancy date in the lease.')
  return { answers, generated: generateSchedule({ answers, today }) }
}
