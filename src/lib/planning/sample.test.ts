import { describe, expect, it } from 'vitest'
import { sampleProject } from './sample'
import { elicit } from './elicitation'
import { recoveryPlan } from './recovery'

describe('sample project', () => {
  it('is fully answered, generates a schedule and shows priced recovery options', () => {
    const { answers, generated } = sampleProject('2026-10-04')
    expect(new Date(answers['project.target_start'].value + 'T00:00:00Z').getUTCDay()).toBe(1)
    expect(generated.activities.length).toBeGreaterThan(40)
    expect(generated.cpm!.projectFinish > String(answers['project.required_finish'].value)).toBe(true)
    expect(elicit({ answers }).readiness).toBeGreaterThanOrEqual(60)
    const r = recoveryPlan(generated, answers, null)!
    expect(r.options.find(o => o.id === 'workweek')!.impact.cost).not.toBeNull()
  })
})
