// Basis of Schedule narrative (Markdown). Deterministic — no model needed, so it works air-gapped.
// It documents what the schedule assumes, where each number came from, what was withheld,
// and every human override, which is what reviewers and claims consultants look for.

import type { GeneratedSchedule } from '@/lib/planning/types'
import { fmtDates } from '@/lib/format'
import type { Evaluation } from '@/lib/planning/evaluation'
import type { ExpertReview } from '@/lib/db'
import { PROJECT_TYPE_LABELS } from '@/lib/planning/types'
import type { ProjectProfile } from '@/lib/planning/types'

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function basisOfSchedule(opts: {
  planName: string
  profile: ProjectProfile
  schedule: GeneratedSchedule
  evaluation: Evaluation
  reviews: ExpertReview[]
  generatedBy: string
  aiMode: string
  teamNotes?: string[]
}): string {
  const { planName, profile, schedule: s, evaluation: ev, reviews } = opts
  const t = s.cpm?.times || {}
  const byId = new Map(s.activities.map(a => [a.id, a]))
  const critical = (s.cpm?.criticalPath || []).map(id => byId.get(id)).filter(Boolean)
  const L: string[] = []

  L.push(`# Basis of Schedule — ${planName}`, '')
  L.push(`Prepared ${new Date().toISOString().slice(0, 10)} by ${opts.generatedBy} with Planora (AI mode: ${opts.aiMode}).`, '')

  L.push('## 1. Project description', '')
  L.push(`| Item | Value |`, `|---|---|`)
  L.push(`| Facility type | ${profile.projectType ? PROJECT_TYPE_LABELS[profile.projectType] : 'Not stated'} |`)
  L.push(`| Location | ${[profile.city, profile.state].filter(Boolean).join(', ') || 'Not stated'} |`)
  L.push(`| Scope | ${profile.scope?.replace(/_/g, ' ') || 'Not stated'} |`)
  L.push(`| Gross area | ${profile.grossSqft ? profile.grossSqft.toLocaleString() + ' sf' : 'Not stated'} |`)
  L.push(`| Stories | ${profile.stories ?? 'Not stated'} |`)
  L.push(`| Delivery method | ${profile.deliveryMethod?.toUpperCase() || 'Not stated'} |`)
  L.push(`| Federal | ${profile.isFederal ? 'Yes' : 'No'}${profile.classification ? ` (${profile.classification})` : ''} |`)
  L.push('')

  L.push('## 2. Key dates', '')
  L.push(`| Milestone | Date |`, `|---|---|`)
  L.push(`| Notice to Proceed | ${s.projectStart} |`)
  for (const a of s.activities.filter(a => a.type === 'milestone' && a.category !== 'ntp')) L.push(`| ${esc(a.name)} | ${t[a.id]?.earlyFinish ?? '—'} |`)
  L.push(`| Deterministic finish | ${ev.forecast.deterministic} |`)
  L.push(`| Risk-adjusted P50 / P80 | ${ev.forecast.p50} / ${ev.forecast.p80} |`)
  if (ev.forecast.requiredFinish) L.push(`| Required finish | ${ev.forecast.requiredFinish} |`)
  L.push('', `Risk basis: ${ev.forecast.basis}`, '')

  L.push('## 3. Calendars', '')
  for (const c of s.calendars) L.push(`- **${esc(c.name)}** — ${c.canonical || ''}; ${c.holidays.length} holidays through ${c.holidays[c.holidays.length - 1] || 'n/a'}.`)
  L.push('', 'Durations are in work days on each activity\'s calendar. Agency reviews and fabrication run on calendar days.', '')

  L.push('## 4. Sources of durations and logic', '')
  const counts: Record<string, number> = {}
  for (const a of s.activities) for (const src of a.rationale.sources) counts[src.kind] = (counts[src.kind] || 0) + 1
  const labels: Record<string, string> = { user: 'Project team answers', file: 'Uploaded files', catalog: 'Regional permit / regulation / lead-time catalog', firm_history: "Firm's own completed projects (private)", template: 'Planora activity templates', model: 'AI model suggestions', override: 'Scheduler overrides', assumption: 'Stated assumptions' }
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) L.push(`- ${labels[k] || k}: cited by ${n} activities`)
  L.push('', ...((s.notes || []).map(n => `> ${n}`)), '')

  L.push('## 5. Assumptions and open items', '')
  const open = s.assumptions.filter(a => a.kind !== 'inferred')
  if (!open.length) L.push('All interview questions were answered.')
  for (const a of open) L.push(`- ${a.kind === 'withheld' ? '**[Withheld]** ' : ''}${esc(a.text)}${a.bufferDays ? ` — buffer ${a.bufferDays} work days` : ''}`)
  const inferred = s.assumptions.filter(a => a.kind === 'inferred')
  if (inferred.length) { L.push('', 'Resolved items:'); for (const a of inferred) L.push(`- ${esc(a.text)}`) }
  L.push('')

  if (opts.teamNotes?.length) {
    L.push('### Additional information from the project team', '')
    for (const n of opts.teamNotes) L.push(`- ${esc(n)}`)
    L.push('')
  }

  const placeholders = s.activities.filter(a => a.placeholder)
  if (placeholders.length) {
    L.push('## 6. Withheld constraints', '')
    L.push('Some constraints were deliberately not shared with the tool. They are represented by placeholders that reserve time without describing the constraint. A cleared scheduler should position them on-site; no details are recorded here.', '')
    for (const a of placeholders) L.push(`- ${a.code} ${esc(a.name)}: ${a.duration} work days, ${t[a.id]?.earlyStart ?? '—'} to ${t[a.id]?.earlyFinish ?? '—'}`)
    L.push('')
  }

  L.push(`## ${placeholders.length ? 7 : 6}. Critical path`, '')
  L.push('| ID | Activity | Duration | Start | Finish | Why this duration |', '|---|---|---|---|---|---|')
  for (const a of critical) if (a) L.push(`| ${a.code} | ${esc(a.name)} | ${a.duration} | ${t[a.id]?.earlyStart ?? ''} | ${t[a.id]?.earlyFinish ?? ''} | ${esc(a.rationale.summary).slice(0, 220)} |`)
  L.push('')

  let n = placeholders.length ? 8 : 7
  L.push(`## ${n++}. Quality assessment`, '')
  L.push(`Overall score ${ev.score}/100 (grade ${ev.grade}). DCMA 14-point: ${ev.dcma.passed}/${ev.dcma.applicable} applicable checks passed. Interview readiness ${ev.readiness}%.`, '')
  L.push('| # | Check | Metric | Threshold | Result |', '|---|---|---|---|---|')
  for (const c of ev.dcma.checks) L.push(`| ${c.id} | ${c.name} | ${c.metric} | ${c.threshold} | ${c.result.toUpperCase()} |`)
  L.push('')
  if (ev.benchmark.rows.length) {
    L.push(`Benchmark against firm actuals (${ev.benchmark.basis}):`, '')
    L.push('| ID | Activity | Planned | Firm P20–P80 | Verdict |', '|---|---|---|---|---|')
    for (const r of ev.benchmark.rows) L.push(`| ${r.code} | ${esc(r.name)} | ${r.planned} | ${r.firmP20}–${r.firmP80} | ${r.verdict.replace('_', ' ')} |`)
    L.push('')
  }
  if (ev.findings.length) { L.push('Findings:', ''); for (const f of ev.findings) L.push(`- ${esc(f)}`); L.push('') }

  const overrides = [
    ...s.activities.flatMap(a => (a.overrides || []).map(o => ({ what: `${a.code} ${a.name}`, o }))),
    ...s.links.flatMap(l => (l.overrides || []).map(o => ({ what: `${byId.get(l.from)?.code} → ${byId.get(l.to)?.code}`, o }))),
    ...(s.removed || []).map(r => ({ what: r.name, o: r.override })),
  ].sort((a, b) => a.o.at.localeCompare(b.o.at))
  L.push(`## ${n++}. Scheduler overrides`, '')
  if (!overrides.length) L.push('None. All durations and logic are as proposed by the tool with the sources above.')
  else {
    L.push('| When | By | Item | Change | Reason |', '|---|---|---|---|---|')
    for (const { what, o } of overrides) L.push(`| ${o.at.slice(0, 16).replace('T', ' ')} | ${esc(o.by)} | ${esc(what)} | ${o.field}${o.from !== undefined ? `: ${esc(String(o.from))}` : ''}${o.to !== undefined ? ` → ${esc(String(o.to))}` : ''} | ${esc(o.reason)} |`)
  }
  L.push('')

  L.push(`## ${n++}. Expert review`, '')
  if (!reviews.length) L.push('Not yet reviewed.')
  for (const r of reviews) L.push(`- ${r.at.slice(0, 10)} — ${esc(r.reviewer)}: **${r.verdict.replace(/_/g, ' ')}**. ${esc(r.comment)}`)
  L.push('')
  L.push('---', 'Reference ranges for permits, regulations and lead times must be verified with the Authority Having Jurisdiction and suppliers. This narrative was generated from the schedule data without an AI model.')
  return fmtDates(L.join('\n'))
}
