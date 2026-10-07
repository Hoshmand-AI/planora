// Which security classification the project data in a request carries, so the model provider can
// refuse to send CUI or classified content to a cloud model (see src/lib/llm/provider.ts and
// docs/security/CUI-HANDLING.md). The interview records it as answers['security.classification'].

import { query } from '@/lib/db'

export type DataClassification = 'unclassified' | 'cui' | 'classified'

/** Classification from a stored interview answer. A withheld answer is treated as classified (as the interview does). */
export function classificationFromAnswer(a: unknown): DataClassification | null {
  if (!a || typeof a !== 'object') return null
  const { status, value } = a as { status?: string; value?: unknown }
  if (status === 'withheld') return 'classified'
  if (status === 'known' && (value === 'cui' || value === 'classified' || value === 'unclassified')) return value
  return null
}

/** CUI and classified information must not leave an accredited (on-prem / air-gapped) environment. */
export const isRestrictedClassification = (c: string | null | undefined) => c === 'cui' || c === 'classified'

/** Returned with 409 when the commercial cloud service is asked to hold a classified schedule or plan. */
export const CLASSIFIED_CLOUD_REFUSAL = 'This is the commercial cloud service, which is not accredited for classified information, so it does not accept or process schedules or plans marked classified. Use the on-premises / air-gapped Planora package (container image and Docker Compose bundle; see docs/operations/ON-PREM-INSTALL.md) inside your accredited enclave. If this item was marked classified by mistake, mark it unclassified or CUI instead; if it is classified, delete it here and report it to your security officer.'
export const CLASSIFIED_CLOUD_CODE = 'classified_on_commercial_cloud'

/**
 * The refusal message when `classification` is 'classified' on the commercial cloud deployment, else
 * null. On-prem and air-gapped deployments accept classified data. Pure: the deployment is passed in.
 */
export function classifiedCloudRefusal(classification: string | null | undefined, deployment: 'commercial_cloud' | 'on_prem' | 'airgapped'): string | null {
  return classification === 'classified' && deployment === 'commercial_cloud' ? CLASSIFIED_CLOUD_REFUSAL : null
}

/** The interview answer that marks a plan classified (an explicit answer; a withheld one is not a marking). */
export const planMarkedClassified = (answers: Record<string, unknown> | null | undefined) => {
  const a = answers?.['security.classification'] as { status?: string; value?: unknown } | null | undefined
  return !!a && a.status === 'known' && a.value === 'classified'
}

async function ofPlan(planId: string, orgId: string): Promise<DataClassification | null> {
  const res = await query(`SELECT answers->'security.classification' AS c FROM plans WHERE id=$1 AND org_id=$2`, [planId, orgId])
  return classificationFromAnswer(res.rows[0]?.c)
}

const RANK: Record<DataClassification, number> = { unclassified: 0, cui: 1, classified: 2 }
const isClassification = (c: unknown): c is DataClassification => c === 'unclassified' || c === 'cui' || c === 'classified'

/** The most restrictive of several classifications (null when none is set). */
export function mostRestrictive(...cs: (string | null | undefined)[]): DataClassification | null {
  let out: DataClassification | null = null
  for (const c of cs) if (isClassification(c) && (out === null || RANK[c] > RANK[out])) out = c
  return out
}

/** An uploaded schedule: its own classification setting and, when built in Planora, its plan's. */
async function ofSchedule(scheduleId: string, orgId: string): Promise<DataClassification | null> {
  const res = await query(`SELECT s.classification AS own, p.answers->'security.classification' AS c FROM schedules s
    LEFT JOIN plans p ON p.id = s.plan_id AND p.org_id = s.org_id
    WHERE s.id=$1 AND s.org_id=$2`, [scheduleId, orgId])
  const row = res.rows[0]
  return row ? mostRestrictive(row.own, classificationFromAnswer(row.c)) : null
}

/** Classification of a schedule for export markings (same rules as the AI guard). */
export const scheduleClassification = ofSchedule
/** Classification of a plan for export markings. */
export const planClassification = ofPlan

/** Routes whose JSON body names the schedule the model will be asked about. */
const BODY_SCHEDULE_ROUTES = new Set(['/api/ask', '/api/reports'])

/**
 * Builds the (lazy, memoized) classification lookup for a request. Only project-scoped routes get
 * one; the lookup runs only if the request actually tries to call a model. A failed lookup is
 * treated as classified, so an error never lets restricted content through.
 */
export function classificationResolver(req: Request, path: string, orgId: string): (() => Promise<string | null>) | undefined {
  const plan = /^\/api\/plans\/([^/]+)/.exec(path)?.[1]
  const schedule = /^\/api\/schedules\/([^/]+)/.exec(path)?.[1]
  // Clone before the handler consumes the body.
  const bodyCopy = !plan && !schedule && req.method === 'POST' && BODY_SCHEDULE_ROUTES.has(path) ? req.clone() : null
  if (!plan && !schedule && !bodyCopy) return undefined
  let memo: Promise<string | null> | null = null
  const resolve = async (): Promise<string | null> => {
    try {
      if (plan) return await ofPlan(decodeURIComponent(plan), orgId)
      if (schedule) return await ofSchedule(decodeURIComponent(schedule), orgId)
      const b = await bodyCopy!.json().catch(() => ({})) as { scheduleId?: unknown }
      return typeof b.scheduleId === 'string' ? await ofSchedule(b.scheduleId, orgId) : null
    } catch {
      return 'classified'
    }
  }
  return () => (memo ??= resolve())
}
