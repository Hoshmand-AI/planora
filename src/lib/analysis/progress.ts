// Schedule progress for the dashboard: duration-weighted physical % complete of the work activities
// (the timeline's phase bars use the same weighting). Counting finished activities instead showed 0%
// for a project with every activity under way, and let milestones, LOE and WBS summaries count.

import type { Activity } from '@/lib/db'

export function schedulePercentComplete(activities: Pick<Activity, 'activityType' | 'duration' | 'percentComplete' | 'status' | 'actualFinish'>[]): number {
  const work = activities.filter(a => a.activityType !== 'milestone' && a.activityType !== 'loe' && a.activityType !== 'summary')
  const total = work.reduce((s, a) => s + Math.max(0, a.duration || 0), 0)
  if (total <= 0) {
    // Nothing with duration (milestones only): the share of finished ones.
    const ms = activities.filter(a => a.activityType === 'milestone')
    return ms.length ? Math.round((100 * ms.filter(a => a.status === 'complete' || !!a.actualFinish).length) / ms.length) : 0
  }
  const done = work.reduce((s, a) => {
    const pct = a.status === 'complete' || a.actualFinish ? 100 : Math.min(100, Math.max(0, Number(a.percentComplete) || 0))
    return s + Math.max(0, a.duration || 0) * pct / 100
  }, 0)
  const pct = (100 * done) / total
  // Never round an unfinished project up to 100% or a started one down to 0%.
  return pct >= 100 ? 100 : pct > 99 ? 99 : pct > 0 && pct < 1 ? 1 : Math.round(pct)
}
