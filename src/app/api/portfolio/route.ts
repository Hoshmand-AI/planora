import { api, json } from '@/lib/server/api'
import { getSchedules, listPlans } from '@/lib/db'
import { buildPortfolio } from '@/lib/planning/portfolio'

/** Every plan and uploaded schedule in the organization, with alerts, most urgent first. */
export const GET = api({ permission: 'read', apiKey: true }, async (_req, { auth }) => {
  const [plans, schedules] = await Promise.all([listPlans(auth.orgId), getSchedules(auth.orgId)])
  return json(buildPortfolio(plans, schedules))
})
