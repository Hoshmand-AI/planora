import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The Time Impact Analysis routes exist and carry the intended permissions: reads with 'read', writes
// (events, runs, accept) with 'schedule.write' like other schedule writes, the AI narrative with 'ai.use'.
const DIR = path.join(process.cwd(), 'src/app/api/schedules/[id]/time-impact')
const handlers = (rel: string) => {
  const src = fs.readFileSync(path.join(DIR, rel), 'utf8')
  return Object.fromEntries([...src.matchAll(/export\s+const\s+(GET|POST|PATCH|DELETE)\s*=\s*api[^(]*\(\{\s*permission:\s*'([a-z.]+)'/g)].map(m => [m[1], m[2]]))
}

describe('time impact API routes', () => {
  it('delay events: list (read) and create (schedule.write)', () => expect(handlers('route.ts')).toEqual({ GET: 'read', POST: 'schedule.write' }))
  it('one event: read, update / accept / reject and delete (schedule.write)', () => expect(handlers('[eventId]/route.ts')).toEqual({ GET: 'read', PATCH: 'schedule.write', DELETE: 'schedule.write' }))
  it('runs: list (read) and run (schedule.write)', () => expect(handlers('[eventId]/runs/route.ts')).toEqual({ GET: 'read', POST: 'schedule.write' }))
  it('one run: report (read) and AI narrative (ai.use)', () => expect(handlers('[eventId]/runs/[runId]/route.ts')).toEqual({ GET: 'read', POST: 'ai.use' }))
  it('create, run, accept and reject are audited', () => {
    const all = ['route.ts', '[eventId]/route.ts', '[eventId]/runs/route.ts'].map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n')
    for (const a of ['tia.event_create', 'tia.run', 'tia.accept', 'tia.reject']) expect(all).toContain(a)
  })
})
