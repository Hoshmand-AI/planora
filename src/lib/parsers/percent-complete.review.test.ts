import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parseXER } from './xer-parser'
import { parseMSProjectXML } from './xml-parser'

// Found by a line-by-line review: P6 leaves physical % at 0 for Duration-type activities, and an MS Project
// elapsed remaining duration was read as working time.
describe('P6 XER percent complete follows the percent-complete type', () => {
  const sample = fs.readFileSync(path.join(process.cwd(), 'src/lib/parsers/__fixtures__/sample.xer'), 'latin1')
  it('a Duration-type activity half way through its duration reads 50%, not its physical 0%', () => {
    const lines = sample.split(/\r?\n/)
    const ti = lines.findIndex(l => l.startsWith('%T\tTASK'))
    const f = lines[ti + 1].split('\t')
    const col = (k: string) => f.indexOf(k)
    for (const k of ['status_code', 'complete_pct_type', 'phys_complete_pct', 'target_drtn_hr_cnt', 'remain_drtn_hr_cnt']) expect(col(k), k).toBeGreaterThan(0)
    const ri = lines.findIndex((l, i) => i > ti + 1 && l.startsWith('%R') && l.split('\t')[col('status_code')] === 'TK_Active')
    const r = lines[ri].split('\t')
    r[col('complete_pct_type')] = 'CP_Drtn'; r[col('phys_complete_pct')] = '0'; r[col('target_drtn_hr_cnt')] = '80'; r[col('remain_drtn_hr_cnt')] = '40'
    lines[ri] = r.join('\t')
    const p = parseXER(lines.join('\r\n'), 's')
    const code = r[col('task_code')]
    expect(p.activities.find(a => a.activityId === code)!.percentComplete).toBe(50)
  })
})

describe('MS Project elapsed durations', () => {
  it('a not-started "30 edays" task is 21 work days, remaining included', () => {
    const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Name>P</Name><StartDate>2026-03-02T08:00:00</StartDate><MinutesPerDay>480</MinutesPerDay><Tasks>
      <Task><UID>1</UID><ID>1</ID><Name>Cure</Name><Duration>PT720H0M0S</Duration><DurationFormat>8</DurationFormat><RemainingDuration>PT720H0M0S</RemainingDuration><Start>2026-03-02T08:00:00</Start><Finish>2026-04-01T08:00:00</Finish><PercentComplete>0</PercentComplete></Task>
      <Task><UID>2</UID><ID>2</ID><Name>Strip forms</Name><Duration>PT40H0M0S</Duration><DurationFormat>7</DurationFormat><Start>2026-04-01T08:00:00</Start><Finish>2026-04-07T17:00:00</Finish><PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task>
    </Tasks></Project>`
    const p = parseMSProjectXML(xml, 's')
    const cure = p.activities.find(a => a.name === 'Cure')!
    expect(cure.duration).toBe(21)
    expect(cure.remainingDuration).toBe(21)
  })
})
