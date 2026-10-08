// Persistence of standards runs (standards_runs, migration 13). Every read and write is scoped by
// org_id; callers load the schedule or plan first (organization- and workspace-scoped), so a run is
// only reachable through a subject the caller may see. Runs are immutable once written.

import { randomUUID } from 'crypto'
import { initSchema, query } from '@/lib/db'
import type { EngineConfig } from './rule'
import type { Framework, RuleResultStatus, StandardsRunOutput } from './types'

export interface StoredRunSummary {
  id: string
  subjectType: 'schedule' | 'plan'
  subjectId: string
  subjectVersion: string | null
  frameworks: Framework[]
  frameworkVersions: Record<string, string>
  engineVersion: string
  rulesVersion: string
  basis: string | null
  summary: Record<string, { counts: Record<RuleResultStatus, number>; score: number | null; conflicts: number }>
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

export interface StoredRun extends StoredRunSummary {
  thresholds: EngineConfig
  results: StandardsRunOutput
}

const iso = (v: unknown) => { const d = v instanceof Date ? v : new Date(String(v)); return isNaN(d.getTime()) ? String(v) : d.toISOString() }

function rowToSummary(r: Record<string, unknown>): StoredRunSummary {
  return {
    id: String(r.id), subjectType: r.subject_type as 'schedule' | 'plan', subjectId: String(r.schedule_id ?? r.plan_id),
    subjectVersion: (r.subject_version as string) ?? null, frameworks: (r.frameworks as Framework[]) || [],
    frameworkVersions: (r.framework_versions as Record<string, string>) || {}, engineVersion: String(r.engine_version), rulesVersion: String(r.rules_version),
    basis: (r.basis as string) ?? null, summary: (r.summary as StoredRunSummary['summary']) || {},
    createdBy: (r.created_by as string) ?? null, createdByName: (r.created_by_name as string) ?? null, createdAt: iso(r.created_at),
  }
}

export function summarizeRun(run: StandardsRunOutput): StoredRunSummary['summary'] {
  return Object.fromEntries(run.frameworks.map(f => [f.framework, { counts: f.counts, score: f.score, conflicts: f.conflicts.length }]))
}

export async function saveStandardsRun(o: { orgId: string; userId: string; basis: string | null; thresholds: EngineConfig; run: StandardsRunOutput }): Promise<StoredRunSummary> {
  await initSchema()
  const id = randomUUID()
  const s = o.run.subject
  const res = await query(`INSERT INTO standards_runs (id, org_id, subject_type, schedule_id, plan_id, subject_version, frameworks, framework_versions, engine_version, rules_version, thresholds, basis, results, summary, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [
    id, o.orgId, s.kind, s.kind === 'schedule' ? s.id : null, s.kind === 'plan' ? s.id : null, s.version ?? null,
    o.run.frameworks.map(f => f.framework), JSON.stringify(Object.fromEntries(o.run.frameworks.map(f => [f.framework, f.frameworkVersion]))),
    o.run.engineVersion, o.run.rulesVersion, JSON.stringify(o.thresholds), o.basis, JSON.stringify(o.run), JSON.stringify(summarizeRun(o.run)), o.userId,
  ])
  return rowToSummary(res.rows[0])
}

const subjectCol = (t: 'schedule' | 'plan') => (t === 'schedule' ? 'schedule_id' : 'plan_id')

export async function listStandardsRuns(orgId: string, subjectType: 'schedule' | 'plan', subjectId: string, limit = 50): Promise<StoredRunSummary[]> {
  await initSchema()
  const res = await query(`SELECT r.id, r.subject_type, r.schedule_id, r.plan_id, r.subject_version, r.frameworks, r.framework_versions, r.engine_version, r.rules_version, r.basis, r.summary, r.created_by, r.created_at, u.name AS created_by_name
    FROM standards_runs r LEFT JOIN users u ON u.id = r.created_by
    WHERE r.org_id=$1 AND r.${subjectCol(subjectType)}=$2 ORDER BY r.created_at DESC LIMIT $3`, [orgId, subjectId, Math.min(Math.max(limit, 1), 200)])
  return res.rows.map(rowToSummary)
}

export async function getStandardsRun(orgId: string, subjectType: 'schedule' | 'plan', subjectId: string, runId: string): Promise<StoredRun | undefined> {
  await initSchema()
  const res = await query(`SELECT r.*, u.name AS created_by_name FROM standards_runs r LEFT JOIN users u ON u.id = r.created_by
    WHERE r.org_id=$1 AND r.${subjectCol(subjectType)}=$2 AND r.id=$3`, [orgId, subjectId, runId])
  const r = res.rows[0]
  return r ? { ...rowToSummary(r), thresholds: r.thresholds as EngineConfig, results: r.results as StandardsRunOutput } : undefined
}
