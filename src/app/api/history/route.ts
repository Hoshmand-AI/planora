import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { getOrgHistory, getOrganization, getSchedules } from '@/lib/db'
import { computeFirmHistory } from '@/lib/planning/history'
import { backtest } from '@/lib/planning/evaluation'
import type { ProjectType } from '@/lib/planning/types'

/** The firm's private knowledge base: what its own projects actually did, plus a leave-one-out backtest. */
export const GET = api({ permission: 'read' }, async (_req, { auth: ctx }) => {
  const [org, schedules, { rows, calendars, selection }] = await Promise.all([getOrganization(ctx.orgId), getSchedules(ctx.orgId), getOrgHistory(ctx.orgId)])
  const history = computeFirmHistory(rows, calendars)
  const uploaded = schedules.filter(s => s.sourceType !== 'generated')
  const bt = backtest(uploaded.map(s => ({ scheduleId: s.id, name: `${s.name} (${s.version})`, projectType: s.projectType as ProjectType | null, state: s.region, grossSqft: s.grossSqft })), rows, calendars)
  return NextResponse.json({
    organization: org,
    privacy: 'Only schedules uploaded by your organization are used. Nothing is shared with or learned from other firms.',
    // Which uploads calibrate history and why the others do not (as-built only, one per project, ...).
    schedules: uploaded.map(s => {
      const ex = selection.excluded.find(x => x.id === s.id)
      return { id: s.id, name: s.name, version: s.version, projectType: s.projectType, region: s.region, grossSqft: s.grossSqft, activityCount: s.activityCount, usedInHistory: selection.included.includes(s.id), historyNote: ex?.detail ?? null }
    }),
    categories: Object.values(history.byCategory).sort((a, b) => b!.samples - a!.samples),
    overallOverrunMedian: history.overallOverrunMedian,
    overallOverrunP80: history.overallOverrunP80,
    backtest: bt,
  })
})
