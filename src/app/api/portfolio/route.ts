import { api, json } from '@/lib/server/api'
import { getSchedules, listMembers, listPlans } from '@/lib/db'
import { buildPortfolio } from '@/lib/planning/portfolio'

/** Every plan and uploaded schedule in the organization, with alerts, most urgent first. */
export const GET = api({ permission: 'read', apiKey: true }, async (_req, { auth }) => {
  const [plans, schedules, members] = await Promise.all([listPlans(auth.orgId), getSchedules(auth.orgId), listMembers(auth.orgId)])
  // Who added each project, by name (members of this organization only).
  const names = Object.fromEntries(members.map(m => [m.id, m.name || m.email]))
  return json(buildPortfolio(plans, schedules, undefined, names))
})
