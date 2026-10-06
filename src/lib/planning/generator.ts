// Build a CPM schedule from the interview, grounded in regional catalogs and the firm's own history.
// Every activity and link carries a Rationale so the scheduler can see WHY, and every human
// override is preserved across regeneration.

import type {
  Answer, Assumption, CanonicalCategory, CpmResult, GeneratedSchedule, LinkType, Override, PlanActivity, PlanLink,
  ProjectProfile, Rationale, SourceRef, TemplateActivity, WorkCalendar, Weekday,
} from './types'
import { isCivilType } from './types'
import { runCpm } from './cpm'
import { usFederalHolidaysRange, addCalendarDays, nextWorkDay } from './calendar'
import { elicit, known, profileFrom, questionBank, unansweredAssumption, milestoneTargetsFor } from './elicitation'
import { historyDuration, type FirmHistory } from './history'
import { templatesFor, computeTemplateDuration, mapToSelected } from '@/lib/knowledge/templates'
import { resolveRegional } from '@/lib/knowledge/regions'
import { appliesTri } from '@/lib/knowledge/applicability'
import { categoryLabel, phaseOf } from '@/lib/semantic/taxonomy'
import { midSentence } from '@/lib/format'

export interface GenerateInput {
  answers: Record<string, Answer>
  history?: FirmHistory | null
  /** Previous generation: its overrides and deletions are re-applied */
  previous?: GeneratedSchedule | null
  today?: string
}

const FIELD = 'cal-field'
const CAL7 = 'cal-7d'

const WORKWEEKS: Record<string, { days: Weekday[]; hours: number; label: string }> = {
  '5x8': { days: [1, 2, 3, 4, 5], hours: 8, label: '5-day (Mon–Fri) × 8h' },
  '5x10': { days: [1, 2, 3, 4, 5], hours: 10, label: '5-day (Mon–Fri) × 10h' },
  '4x10': { days: [1, 2, 3, 4], hours: 10, label: '4-day (Mon–Thu) × 10h' },
  '6x10': { days: [1, 2, 3, 4, 5, 6], hours: 10, label: '6-day (Mon–Sat) × 10h' },
  '7x12': { days: [0, 1, 2, 3, 4, 5, 6], hours: 12, label: '7-day × 12h' },
}

const src = (kind: SourceRef['kind'], label: string, detail?: string): SourceRef => ({ kind, label, detail })
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : undefined)

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
}

class Builder {
  acts = new Map<string, PlanActivity>()
  links = new Map<string, PlanLink>()
  byCat = new Map<CanonicalCategory, string>()

  add(a: Omit<PlanActivity, 'code'> & { code?: string }): PlanActivity {
    const act = { code: '', ...a } as PlanActivity
    this.acts.set(act.id, act)
    if (!this.byCat.has(act.category)) this.byCat.set(act.category, act.id)
    return act
  }

  link(from: string, to: string, type: LinkType, lag: number, rationale: Rationale): void {
    if (from === to || !this.acts.has(from) || !this.acts.has(to)) return
    const id = `${from}>${to}`
    if (this.links.has(id)) return
    this.links.set(id, { id, from, to, type, lag, rationale })
  }

  /** Insert `mid` in front of `target`: every link into target is re-pointed into mid, then mid → target. */
  insertBefore(mid: string, target: string, rationale: Rationale) {
    for (const l of [...this.links.values()]) {
      if (l.to === target && l.from !== mid) {
        this.links.delete(l.id)
        this.link(l.from, mid, l.type, l.lag, l.rationale)
      }
    }
    this.link(mid, target, 'FS', 0, rationale)
  }
}

export function generateSchedule(input: GenerateInput): GeneratedSchedule {
  const { answers, history } = input
  const today = input.today || new Date().toISOString().slice(0, 10)
  const profile = profileFrom(answers)
  const bank = questionBank({ answers }, {})
  const elic = elicit({ answers }, { today })
  const regional = resolveRegional(profile)
  const useHistory = known(answers, 'history.use') !== false && !!history

  /* ── Calendars ── */
  const requestedStart = (known(answers, 'project.target_start') as string) || addCalendarDays(today, 30)
  const wwKey = (known(answers, 'calendar.workweek') as string) || '5x8'
  const ww = WORKWEEKS[wwKey] || WORKWEEKS['5x8']
  const startYear = Number(requestedStart.slice(0, 4))
  const holidays = known(answers, 'calendar.holidays') === false ? [] : usFederalHolidaysRange(startYear, startYear + 6)
  const calendars: WorkCalendar[] = [
    { id: FIELD, name: `Field work — ${ww.label}`, workDays: ww.days, hoursPerDay: ww.hours, holidays, canonical: ww.label },
    { id: CAL7, name: 'Calendar days (agency reviews, fabrication, delivery)', workDays: [0, 1, 2, 3, 4, 5, 6], hoursPerDay: 8, holidays: [], canonical: '7-day calendar' },
  ]
  // NTP must fall on a working day, otherwise it displays before the data date (DCMA #9).
  const start = nextWorkDay(requestedStart, calendars[0])
  // Template productivity assumes 8-hour days.
  const hoursFactor = 8 / ww.hours
  const calNote = ww.hours !== 8 ? ` Scaled ×${hoursFactor.toFixed(2)} for ${ww.hours}-hour days.` : ''

  const b = new Builder()
  // Questions not answered yet are planned with their defaults, and said so explicitly (with the same
  // buffers as "don't know") so generating early never hides guesses.
  const notYet = elic.questions.filter(q => q.section !== 'history' && q.section !== 'milestones' && q.section !== 'cost' && !q.id.startsWith('ai.') && !q.id.startsWith('note.'))
  const assumptions: Assumption[] = [...elic.assumptions, ...notYet.map(q => notAnsweredAssumption(q, bank))]
  const notes: string[] = [
    'Permit review times and lead times are reference ranges. Verify with the Authority Having Jurisdiction and suppliers before baselining.',
  ]
  if (regional.climate.adverseMonths.length) notes.push(`Regional climate: ${regional.climate.adverseNote}`)
  if (start !== requestedStart) notes.push(`The target start ${requestedStart} is not a working day, so Notice to Proceed is set to the next working day, ${start}.`)

  /* ── NTP ── */
  const ntp = b.add({
    id: 'ntp', name: 'Notice to Proceed', category: 'ntp', phase: 'preconstruction', type: 'milestone', duration: 0, calendarId: FIELD,
    constraint: { type: 'SNET', date: start },
    rationale: {
      summary: `Project anchored at ${start}.`,
      sources: [known(answers, 'project.target_start') ? src('user', 'Target start from interview') : src('assumption', 'No start date given', 'Assumed 30 days from today')],
      confidence: known(answers, 'project.target_start') ? 'high' : 'low',
    },
  })

  /* ── Design phases remaining ── */
  const drawings = known(answers, 'design.drawings')
  const pct = drawings === false ? 0 : num(known(answers, 'design.percent')) ?? (drawings === true ? 30 : 0)
  const reviewWeeks = num(known(answers, 'design.review_weeks')) ?? (profile.isFederal ? 4 : 2)
  const designRemaining: Partial<Record<CanonicalCategory, number>> = {
    design_sd: pct < 30 ? (30 - pct) / 30 : 0,
    design_dd: pct < 60 ? Math.min(1, (60 - pct) / 30) : 0,
    design_cd: pct < 100 ? Math.min(1, (100 - pct) / 40) : 0,
  }
  const designSource = drawings === undefined ? src('assumption', 'Drawing status unknown', 'Assumed no drawings') : src('user', `Drawings ${drawings ? pct + '% complete' : 'not started'}`)

  /* ── Template activities ── */
  const civil = isCivilType(profile.projectType)
  const templates = templatesFor(profile)
  const skip = new Set<CanonicalCategory>(['ntp', 'permit_site', 'permit_building', 'permit_other', 'procurement', 'submittals', 'design_review'])
  const tmplByCat = new Map<CanonicalCategory, TemplateActivity>(templates.map(t => [t.category, t]))

  for (const t of templates) {
    if (skip.has(t.category)) continue
    const rem = designRemaining[t.category]
    if (rem !== undefined && rem <= 0) continue
    const isMs = !!t.milestone
    let duration = 0
    let rationale: Rationale
    const tmplDays = computeTemplateDuration(t, profile)
    const hist = !isMs && useHistory ? historyDuration(history, t.category, profile.grossSqft) : null
    if (isMs) {
      rationale = { summary: `Milestone from the ${labelType(profile)} template.`, sources: [src('template', 'Planora activity template', t.note)], confidence: 'high' }
    } else if (hist && rem === undefined) {
      duration = hist.days
      const s = hist.stats
      rationale = {
        summary: `${duration} work days = median ACTUAL duration of ${midSentence(categoryLabel(t.category))} on ${s.projects} of your firm's past${s.sameType ? ' ' + labelType(profile) : ''} projects${profile.grossSqft ? `, scaled to ${profile.grossSqft.toLocaleString()} sf` : ''} (your P20–P80: ${Math.round(s.actualP20)}–${Math.round(s.actualP80)} days at 100k sf). Template would give ${Math.round(tmplDays * hoursFactor)}.`,
        sources: [src('firm_history', "Your firm's completed projects", `${s.samples} activities across ${s.projects} projects; private to your firm`), src('template', 'Planora template (for comparison)')],
        confidence: s.projects >= 3 && s.sameType ? 'high' : 'medium',
      }
    } else {
      duration = Math.max(1, Math.round(tmplDays * hoursFactor * (rem ?? 1)))
      const parts = [`base ${t.duration.base}`]
      if (t.duration.perKsf && civil && profile.valueMusd) parts.push(`${t.duration.perKsf}/$1M × ${profile.valueMusd}`)
      else if (t.duration.perKsf && profile.grossSqft) parts.push(`${t.duration.perKsf}/1,000 sf × ${Math.round(profile.grossSqft / 1000)}`)
      if (t.duration.perStory && profile.stories) parts.push(`${t.duration.perStory}/story × ${profile.stories}`)
      rationale = {
        summary: `${duration} work days from the ${labelType(profile)} template (${parts.join(' + ')}, clamped ${t.duration.min}–${t.duration.max}).${calNote}${rem !== undefined && rem < 1 ? ` Only ${Math.round(rem * 100)}% of this design phase remains (drawings ${pct}% complete).` : ''}${useHistory && history && !hist ? ' Not enough firm history for this activity (need 2+ projects).' : ''}`,
        sources: [src('template', 'Planora activity template', t.note), ...(rem !== undefined ? [designSource] : [])],
        confidence: (civil ? profile.valueMusd : profile.grossSqft) ? 'medium' : 'low',
        assumptions: (civil ? profile.valueMusd : profile.grossSqft) ? undefined : [civil ? 'Construction value unknown — sized for a $20M reference project.' : 'Building area unknown — template minimums used.'],
      }
    }
    b.add({
      id: `t-${t.category}`, name: t.name, category: t.category, phase: t.phase, type: isMs ? 'milestone' : 'task',
      duration, calendarId: FIELD, rationale,
    })
  }

  /* ── Owner/agency design reviews ── */
  const designChain: string[] = []
  for (const cat of ['design_sd', 'design_dd', 'design_cd'] as CanonicalCategory[]) {
    const id = `t-${cat}`
    if (!b.acts.has(id)) continue
    designChain.push(id)
    const rid = `review-${cat}`
    b.add({
      id: rid, name: `${profile.isFederal ? 'Agency' : 'Owner'} review — ${categoryLabel(cat)}`, category: 'design_review', phase: 'design', type: 'task',
      duration: reviewWeeks * 7, calendarId: CAL7,
      rationale: {
        summary: `${reviewWeeks}-week review on calendar days.`,
        sources: [known(answers, 'design.review_weeks') !== undefined ? src('user', 'Review period from interview') : src('assumption', 'Review period not given', profile.isFederal ? 'Typical USACE/NAVFAC review' : 'Typical owner review')],
        confidence: known(answers, 'design.review_weeks') !== undefined ? 'high' : 'medium',
      },
    })
    designChain.push(rid)
  }
  const designLogic: Rationale = { summary: 'Design phases proceed in sequence, each after review of the previous submission.', sources: [src('template', 'Standard design sequence')], confidence: 'high' }
  for (let i = 1; i < designChain.length; i++) b.link(designChain[i - 1], designChain[i], 'FS', 0, designLogic)
  if (designChain.length) b.link(ntp.id, designChain[0], 'FS', 0, { summary: 'Design starts at NTP.', sources: [src('template', 'Standard')], confidence: 'high' })
  const designDone = designChain.length ? designChain[designChain.length - 1] : ntp.id
  const ddDone = b.acts.has('review-design_dd') ? 'review-design_dd' : b.acts.has('review-design_sd') ? 'review-design_sd' : designChain.length ? designChain[0] : ntp.id
  const earlyPackages = ['db', 'cmar', 'ipd'].includes(String(known(answers, 'project.delivery')))

  const resolveCat = (cat: CanonicalCategory): string | undefined => {
    if (cat === 'ntp') return ntp.id
    if (cat === 'design_cd' || cat === 'design_review') return designDone
    if (cat === 'design_dd') return b.acts.has('t-design_dd') ? (b.acts.has('review-design_dd') ? 'review-design_dd' : 't-design_dd') : designDone
    if (cat === 'design_sd') return b.acts.has('t-design_sd') ? (b.acts.has('review-design_sd') ? 'review-design_sd' : 't-design_sd') : designDone
    return b.byCat.get(cat)
  }

  /* ── Template logic ── */
  const tmplLogic = (t: TemplateActivity, predCat: CanonicalCategory, type: LinkType, lag: number): Rationale => ({
    summary: type === 'FS' && !lag
      ? `${categoryLabel(predCat)} must finish before ${midSentence(t.name)} starts.`
      : `${t.name} overlaps ${midSentence(categoryLabel(predCat))} (${type}${lag ? ` +${lag}d` : ''}) — standard trade stacking.`,
    sources: [src('template', 'Planora activity template logic')],
    confidence: 'high',
  })
  // Resolve a pred category even when it was skipped (e.g. a permit placeholder) by walking its own preds.
  const resolvePred = (cat: CanonicalCategory, seen = new Set<CanonicalCategory>()): string[] => {
    const hit = resolveCat(cat)
    if (hit) return [hit]
    if (seen.has(cat)) return []
    seen.add(cat)
    const t = tmplByCat.get(cat)
    return t ? t.preds.flatMap(p => resolvePred(p.category, seen)) : []
  }
  for (const t of templates) {
    const id = `t-${t.category}`
    if (!b.acts.has(id) || designChain.includes(id)) continue
    for (const p of t.preds) {
      for (const from of resolvePred(p.category)) b.link(from, id, p.type, p.type === 'FS' ? p.lag : Math.round(p.lag * hoursFactor), tmplLogic(t, p.category, p.type, p.lag))
    }
  }

  /* ── Permits (grounded in the regional catalog + interview) ── */
  // Catalog gates may name a structural system (e.g. steel) — map to the system this project uses.
  const gateTarget = (cat: CanonicalCategory): string =>
    resolveCat(mapToSelected(cat, profile)) || resolveCat('foundations') || resolveCat('mobilization') || ntp.id

  for (const pm of bank.permits) {
    const qid = `permit.${pm.id}.status`
    const a = answers[qid]
    const status = a?.status === 'known' ? String(a.value) : 'not_submitted'
    const catalogSrc = src('catalog', pm.name, `${pm.authority}; ${pm.source}`)
    if (status === 'not_required') continue
    if (status === 'issued') {
      assumptions.push({ questionId: qid, text: `${pm.name} already issued — no review time scheduled.`, bufferDays: 0, kind: 'inferred' })
      continue
    }
    const unknown = !a || a.status !== 'known'
    const submitAfterDD = earlyPackages && pm.gates !== 'foundations' && pm.submitAfter === 'design_cd'
    const submitFrom = submitAfterDD ? ddDone : (resolveCat(pm.submitAfter) || designDone)
    const gate = gateTarget(pm.gates)
    let reviewDays: number
    let reviewWhy: string
    const expected = known(answers, `permit.${pm.id}.expected`) as string | undefined
    if (status === 'submitted' && expected) {
      reviewDays = Math.max(1, daysBetween(start, expected))
      reviewWhy = `In review; you expect issuance ${expected}.`
    } else if (status === 'submitted') {
      reviewDays = Math.round(pm.reviewWeeks.typical * 7 * 0.5)
      reviewWhy = `In review with no expected date; assumed half of the typical ${pm.reviewWeeks.typical}-week review remains.`
    } else {
      reviewDays = pm.reviewWeeks.typical * 7
      reviewWhy = `Typical ${pm.reviewWeeks.typical}-week review (range ${pm.reviewWeeks.low}–${pm.reviewWeeks.high}).`
    }
    let first: string
    if (status === 'submitted') {
      first = b.add({
        id: `permit-${pm.id}`, name: `${pm.name} — review & issuance (in progress)`, category: categoryForPermit(pm.gates), phase: 'permitting', type: 'task',
        duration: reviewDays, calendarId: CAL7,
        rationale: { summary: reviewWhy, sources: [src('user', 'Permit status: submitted'), catalogSrc], confidence: expected ? 'high' : 'medium' },
      }).id
      b.link(ntp.id, first, 'FS', 0, { summary: 'Review already under way at NTP.', sources: [src('user', 'Permit status')], confidence: 'high' })
    } else {
      first = b.add({
        id: `permit-${pm.id}-submit`, name: `Prepare & submit ${pm.name}`, category: categoryForPermit(pm.gates), phase: 'permitting', type: 'task',
        duration: 5, calendarId: FIELD,
        rationale: { summary: `Application package after ${submitAfterDD ? 'design development (early package, ' + known(answers, 'project.delivery') + ')' : midSentence(categoryLabel(pm.submitAfter))}.`, sources: [catalogSrc], confidence: 'medium' },
      }).id
      const rev = b.add({
        id: `permit-${pm.id}`, name: `${pm.name} — ${pm.authority} review & issuance`, category: categoryForPermit(pm.gates), phase: 'permitting', type: 'task',
        duration: reviewDays, calendarId: CAL7,
        rationale: {
          summary: reviewWhy + (unknown ? ' Status unknown — assumed not yet submitted.' : ''),
          sources: [catalogSrc, unknown ? src('assumption', 'Permit status unknown') : src('user', 'Permit status: not submitted')],
          confidence: unknown ? 'low' : 'medium',
          assumptions: pm.notes ? [pm.notes] : undefined,
        },
      })
      b.link(submitFrom, first, 'FS', 0, { summary: `Cannot submit until ${submitAfterDD ? 'design development' : midSentence(categoryLabel(pm.submitAfter))} is complete.`, sources: [catalogSrc], confidence: 'high' })
      b.link(first, rev.id, 'FS', 0, { summary: 'Agency review starts on submission.', sources: [catalogSrc], confidence: 'high' })
      first = rev.id
    }
    b.link(first, gate, 'FS', 0, { summary: `${b.acts.get(gate)?.name || 'Work'} cannot start until the ${pm.name} is issued.`, sources: [catalogSrc], confidence: 'high' })
  }

  /* ── Long-lead procurement ── */
  const submittalStart = earlyPackages ? ddDone : designDone
  for (const it of bank.longLead) {
    const qid = `procure.${it.id}.status`
    const a = answers[qid]
    const status = a?.status === 'known' ? String(a.value) : 'not_released'
    if (status === 'not_in_scope') continue
    const catalogSrc = src('catalog', it.name, it.source)
    const gate = gateTarget(it.gates)
    const delivery = known(answers, `procure.${it.id}.delivery`) as string | undefined
    const unknown = !a || a.status !== 'known'
    if ((status === 'released' || status === 'owner_furnished') && delivery) {
      const ms = b.add({
        id: `ll-${it.id}-delivered`, name: `${it.name} delivered${status === 'owner_furnished' ? ' (owner-furnished)' : ''}`, category: 'procurement', phase: 'procurement', type: 'milestone',
        duration: 0, calendarId: CAL7, constraint: { type: 'SNET', date: delivery },
        rationale: { summary: `Committed delivery ${delivery}; held as a start-no-earlier-than constraint.`, sources: [src('user', 'Delivery date from interview'), catalogSrc], confidence: 'high' },
      })
      b.link(ntp.id, ms.id, 'FS', 0, { summary: 'Delivery tracked from NTP.', sources: [src('user', 'Delivery date')], confidence: 'high' })
      b.link(ms.id, gate, 'FS', 0, { summary: `Installation needs ${midSentence(it.name)} on site.`, sources: [catalogSrc], confidence: 'high' })
      continue
    }
    if (status === 'released' || status === 'owner_furnished') {
      const fab = b.add({
        id: `ll-${it.id}-fab`, name: `Fabricate & deliver ${it.name}${status === 'owner_furnished' ? ' (owner-furnished)' : ''}`, category: 'procurement', phase: 'procurement', type: 'task',
        duration: it.leadWeeks.typical * 7, calendarId: CAL7,
        rationale: { summary: `Ordered, but no delivery date given — conservatively carried the full typical ${it.leadWeeks.typical}-week lead from NTP.`, sources: [src('user', 'Order status: released'), catalogSrc], confidence: 'medium' },
      })
      b.link(ntp.id, fab.id, 'FS', 0, { summary: 'Order already placed.', sources: [src('user', 'Order status')], confidence: 'high' })
      b.link(fab.id, gate, 'FS', 0, { summary: `Installation needs ${midSentence(it.name)} on site.`, sources: [catalogSrc], confidence: 'high' })
      continue
    }
    const sub = b.add({
      id: `ll-${it.id}-sub`, name: `Submittal & approval — ${it.name}`, category: 'submittals', phase: 'procurement', type: 'task',
      duration: it.submittalWeeks * 7, calendarId: CAL7,
      rationale: { summary: `${it.submittalWeeks} weeks to prepare, review and approve shop drawings.`, sources: [catalogSrc], confidence: 'medium' },
    })
    const fab = b.add({
      id: `ll-${it.id}-fab`, name: `Fabricate & deliver ${it.name}`, category: 'procurement', phase: 'procurement', type: 'task',
      duration: it.leadWeeks.typical * 7, calendarId: CAL7,
      rationale: {
        summary: `Typical lead time ${it.leadWeeks.typical} weeks after approval (market range ${it.leadWeeks.low}–${it.leadWeeks.high}).${unknown ? ' Order status unknown — assumed not ordered.' : ''}`,
        sources: [catalogSrc, unknown ? src('assumption', 'Order status unknown') : src('user', 'Not yet ordered')],
        confidence: unknown ? 'low' : 'medium',
        assumptions: it.notes ? [it.notes] : undefined,
      },
    })
    b.link(submittalStart, sub.id, 'FS', 0, { summary: `Submittals need ${earlyPackages ? 'design development drawings (early release under ' + known(answers, 'project.delivery') + ')' : 'the construction documents'}.`, sources: [catalogSrc], confidence: 'high' })
    b.link(sub.id, fab.id, 'FS', 0, { summary: 'Fabrication is released on submittal approval.', sources: [catalogSrc], confidence: 'high' })
    b.link(fab.id, gate, 'FS', 0, { summary: `Installation needs ${midSentence(it.name)} on site.`, sources: [catalogSrc], confidence: 'high' })
  }

  /* ── Regulations that add activities ── */
  for (const r of bank.regulations) {
    if (!r.addsActivity) continue
    const tri = appliesTri(r.appliesWhen, profile)
    // Unknown applicability is carried conservatively; only an explicit "no" drops it.
    if (tri === 'no' || known(answers, `reg.${r.id}.applies`) === false) continue
    const ad = r.addsActivity
    const act = b.add({
      id: `reg-${r.id}`, name: ad.name, category: ad.category, phase: phaseOf(ad.category), type: 'task',
      duration: Math.round(ad.days.typical * hoursFactor), calendarId: FIELD,
      rationale: { summary: `${r.scheduleImpact} Typical ${ad.days.low}–${ad.days.high} work days.`, sources: [src('catalog', r.name, r.source)], confidence: tri === 'yes' ? 'medium' : 'low' },
    })
    const after = resolveCat(mapToSelected(ad.after, profile)) || ntp.id
    b.link(after, act.id, 'FS', 0, { summary: `Follows ${midSentence(categoryLabel(ad.after))}.`, sources: [src('catalog', r.name, r.source)], confidence: 'medium' })
    const before = ad.before ? resolveCat(mapToSelected(ad.before, profile)) : undefined
    if (before) b.link(act.id, before, 'FS', 0, { summary: `Must be complete before ${midSentence(categoryLabel(ad.before!))}.`, sources: [src('catalog', r.name, r.source)], confidence: 'medium' })
  }

  /* ── Withheld (classified) constraints: plan around what we can't see ── */
  const scId = resolveCat('substantial_completion')
  const withheldCountAns = answers['security.withheld_count']
  const withheldCount = withheldCountAns?.status === 'known' ? Math.max(0, Math.round(num(withheldCountAns.value) ?? 0)) : withheldCountAns?.status === 'withheld' ? 1 : 0
  if (withheldCount > 0) {
    const totalDays = num(known(answers, 'security.withheld_days')) ?? 20 * withheldCount
    const each = Math.max(1, Math.round(totalDays / withheldCount))
    const anchor = resolveCat('mobilization') || ntp.id
    for (let i = 1; i <= withheldCount; i++) {
      const ph = b.add({
        id: `withheld-${i}`, name: `Withheld constraint ${i} — reserved window (details not provided)`, category: 'contingency', phase: 'mep', type: 'task',
        duration: each, calendarId: FIELD, placeholder: true,
        rationale: {
          summary: `You told us a constraint exists but its details are classified. We reserved ${each} work days in parallel with the work and tied it to substantial completion so it consumes float, not hidden time. A cleared scheduler can re-sequence this placeholder on-site without sharing the details.`,
          sources: [src('user', 'Withheld-constraint count and reserve size only')],
          confidence: 'low',
          assumptions: ['Placement is generic: after mobilization, before substantial completion.'],
        },
      })
      b.link(anchor, ph.id, 'FS', 0, { summary: 'Earliest the window could occur.', sources: [src('assumption', 'Generic placement')], confidence: 'low' })
      if (scId) b.link(ph.id, scId, 'FS', 0, { summary: 'Must clear before substantial completion.', sources: [src('assumption', 'Generic placement')], confidence: 'low' })
    }
  }

  /* ── Close open ends so every activity has a predecessor and successor ── */
  const finishId = resolveCat('final_completion') || scId || [...b.acts.keys()].pop()!
  closeOpenEnds(b, ntp.id, finishId, scId)
  decompose(b, profile)
  // Splitting at an overlap point can leave a tail segment whose only successor was the overlap.
  closeOpenEnds(b, ntp.id, finishId, scId)

  /* ── First CPM pass (needed to place weather + contingency) ── */
  const mustFinishBy = known(answers, 'project.required_finish') as string | undefined
  let cpm = cpmOf(b, calendars, start, mustFinishBy)

  /* ── Weather allowance from regional climate ── */
  const earth = resolveCat('earthwork') || resolveCat('foundations')
  const dryIn = resolveCat('dry_in') || resolveCat('roofing')
  if (known(answers, 'calendar.weather') !== false && earth && dryIn && regional.climate.adverseMonths.length && cpm.times[earth] && cpm.times[dryIn]) {
    const months = monthsBetween(cpm.times[earth].earlyStart, cpm.times[dryIn].earlyFinish).filter(m => regional.climate.adverseMonths.includes(m))
    const days = months.length * regional.climate.weatherDaysPerAdverseMonth
    if (days > 0) {
      const w = b.add({
        id: 'weather', name: `Weather allowance (${months.length} adverse month${months.length > 1 ? 's' : ''} before dry-in)`, category: 'contingency', phase: 'envelope', type: 'task',
        duration: days, calendarId: FIELD,
        rationale: {
          summary: `Exterior work from ${cpm.times[earth].earlyStart} to ${cpm.times[dryIn].earlyFinish} spans ${months.length} adverse-weather months for this region × ${regional.climate.weatherDaysPerAdverseMonth} days = ${days} work days. ${regional.climate.adverseNote}`,
          sources: [src('catalog', `Regional climate — ${profile.state || 'US default'}`)],
          confidence: 'medium',
        },
      })
      b.insertBefore(w.id, dryIn, { summary: 'Weather days are carried ahead of dry-in, where exterior exposure ends.', sources: [src('template', 'Common practice: explicit weather activity')], confidence: 'medium' })
    }
  }

  /* ── Contingency for unresolved unknowns (explicit, not hidden in durations) ── */
  const unknownBuffer = assumptions.filter(a => a.kind !== 'inferred').reduce((s, a) => s + a.bufferDays, 0)
  if (scId && unknownBuffer > 0) {
    const projectDays = Math.max(20, cpmSpan(cpm, start))
    const days = Math.min(unknownBuffer, Math.round(projectDays * 0.15))
    const c = b.add({
      id: 'contingency', name: 'Schedule contingency — unresolved unknowns', category: 'contingency', phase: 'closeout', type: 'task',
      duration: days, calendarId: FIELD,
      rationale: {
        summary: `${days} work days reserved for ${assumptions.filter(a => a.kind !== 'inferred' && a.bufferDays > 0).length} unanswered or withheld items (sum of buffers ${unknownBuffer} days, capped at 15% of duration). Answer those questions to release it.`,
        sources: [src('assumption', 'Interview gaps')],
        confidence: 'low',
        assumptions: assumptions.filter(a => a.bufferDays > 0).map(a => `${a.text} (+${a.bufferDays}d)`).slice(0, 12),
      },
    })
    b.insertBefore(c.id, scId, { summary: 'Contingency is held at the end of the path, before substantial completion.', sources: [src('template', 'AACE-style project buffer')], confidence: 'medium' })
  }

  /* ── Milestone targets: held as finish-no-later-than so lateness shows as negative float ── */
  const milestoneTargets: NonNullable<GeneratedSchedule['milestoneTargets']> = []
  for (const m of milestoneTargetsFor(profile)) {
    const target = known(answers, `milestone.${m.key}.target`)
    if (typeof target !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(target)) continue
    const cat = mapToSelected(m.category, profile)
    // The last segment of the category's work package is where the milestone is reached.
    const candidates = [...b.acts.values()].filter(a => a.category === cat && a.id.startsWith('t-'))
    const endAct = candidates.sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true })).pop()
    if (!endAct) continue
    endAct.constraint = { type: 'FNLT', date: target }
    endAct.rationale = { ...endAct.rationale, assumptions: [...(endAct.rationale.assumptions || []), `Must finish by the “${m.label}” target of ${target} (from the interview).`] }
    milestoneTargets.push({ key: m.key, label: m.label, target, activityId: endAct.id })
  }

  /* ── Qualified answers: the team's own words travel with the activities they affect ── */
  const qualifications: NonNullable<GeneratedSchedule['qualifications']> = []
  for (const [qid, a] of Object.entries(answers)) {
    const note = a.note?.trim()
    if (!note || qid.startsWith('note.')) continue
    const q = bank.all.find(x => x.id === qid)
    const shown = a.status !== 'known' ? (a.status === 'withheld' ? 'Withheld' : "Don't know")
      : q?.options?.find(o => o.value === a.value)?.label ?? String(a.value)
    const m = qid.match(/^(permit|procure)\.([^.]+)\./)
    const prefix = m ? (m[1] === 'permit' ? `permit-${m[2]}` : `ll-${m[2]}`) : null
    const affected: string[] = []
    if (prefix) {
      for (const act of b.acts.values()) {
        if (act.id !== prefix && !act.id.startsWith(prefix + '-')) continue
        act.rationale = { ...act.rationale, confidence: 'low', assumptions: [...(act.rationale.assumptions || []), `Team note: “${note}” — review whether this duration and logic reflect it.`] }
        affected.push(act.id)
      }
    }
    qualifications.push({ questionId: qid, prompt: q?.prompt ?? qid, answer: shown, note, activityIds: affected })
  }

  /* ── Re-apply the scheduler's overrides from the previous version ── */
  const removed = reapplyOverrides(b, input.previous)

  cpm = cpmOf(b, calendars, start, mustFinishBy)
  assignCodes(b, cpm)

  return {
    generatedAt: new Date().toISOString(),
    projectStart: start,
    mustFinishBy,
    calendars,
    defaultCalendarId: FIELD,
    activities: [...b.acts.values()].sort((x, y) => x.code.localeCompare(y.code)),
    links: [...b.links.values()],
    assumptions,
    removed,
    notes,
    qualifications,
    milestoneTargets,
    cpm,
  }
}

function notAnsweredAssumption(q: import('./types').Question, bank: ReturnType<typeof questionBank>): Assumption {
  return unansweredAssumption(q, bank.permits, bank.longLead)
}

function labelType(p: ProjectProfile): string {
  return p.projectType ? p.projectType.replace(/_/g, ' ') : 'generic building'
}

function categoryForPermit(gates: CanonicalCategory): CanonicalCategory {
  return gates === 'earthwork' || gates === 'utilities_site' || gates === 'mobilization' ? 'permit_site' : gates === 'foundations' || gates.startsWith('structure') ? 'permit_building' : 'permit_other'
}

function closeOpenEnds(b: Builder, startId: string, finishId: string, scId?: string) {
  const hasPred = new Set([...b.links.values()].map(l => l.to))
  const hasSucc = new Set([...b.links.values()].map(l => l.from))
  for (const a of b.acts.values()) {
    if (a.id !== startId && !hasPred.has(a.id)) {
      b.link(startId, a.id, 'FS', 0, { summary: 'No technical predecessor — tied to NTP so the activity is not open-ended.', sources: [src('template', 'Logic closure (DCMA check 1)')], confidence: 'medium' })
    }
    if (a.id !== finishId && !hasSucc.has(a.id)) {
      const to = scId && a.id !== scId && a.phase !== 'closeout' ? scId : finishId
      b.link(a.id, to, 'FS', 0, { summary: 'No technical successor — tied to completion so its delay shows up in the finish date.', sources: [src('template', 'Logic closure (DCMA check 1)')], confidence: 'medium' })
    }
  }
}

/** DCMA check 8: field activities longer than this are split so progress is measurable. */
export const MAX_FIELD_DURATION = 44
const SEGMENT_TARGET = 40
const LEVEL_PHASES = new Set(['structure', 'mep', 'interiors'])

function segmentLabel(phase: string, i: number, n: number, stories?: number): string {
  if (LEVEL_PHASES.has(phase) && stories && stories >= n) {
    const per = Math.ceil(stories / n)
    const lo = i * per + 1, hi = Math.min(stories, (i + 1) * per)
    return lo === hi ? `Level ${lo}` : `Levels ${lo}–${hi}`
  }
  return phase === 'envelope' ? `Sequence ${i + 1} of ${n}` : `Area ${i + 1} of ${n}`
}

/**
 * Detail long field activities into ≤44-day segments (by level where the building has enough
 * floors, else by area) and restate overlaps as finish-to-start links between segments instead of
 * SS lags and leads. This is how a scheduler takes a summary network to Level 3, and it keeps the
 * DCMA lag/lead/relationship-type/high-duration checks honest.
 */
function decompose(b: Builder, profile: ProjectProfile) {
  const segs = new Map<string, string[]>()
  const segDur = new Map<string, number[]>()
  // Overlap points: a successor that starts N days into a predecessor needs a segment boundary at N.
  const cuts = new Map<string, Set<number>>()
  b.links.forEach(l => {
    const a = b.acts.get(l.from)
    if (l.type === 'SS' && l.lag > 0 && a && a.type === 'task' && l.lag < a.duration) {
      if (!cuts.has(a.id)) cuts.set(a.id, new Set())
      cuts.get(a.id)!.add(l.lag)
    }
  })
  for (const a of [...b.acts.values()]) {
    const long = a.duration > MAX_FIELD_DURATION
    if (a.type !== 'task' || a.calendarId !== FIELD || a.placeholder || a.category === 'contingency' || a.phase === 'design' || (!long && !cuts.has(a.id))) continue
    let durs: number[]
    if (long) {
      const n = Math.ceil(a.duration / SEGMENT_TARGET)
      const base = Math.floor(a.duration / n)
      durs = Array.from({ length: n }, (_, i) => base + (i < a.duration - base * n ? 1 : 0))
    } else {
      const points = [...cuts.get(a.id)!].sort((x, y) => x - y)
      durs = points.map((p2, i) => p2 - (i ? points[i - 1] : 0)).concat(a.duration - points[points.length - 1])
    }
    const n = durs.length
    const ids: string[] = []
    b.acts.delete(a.id)
    durs.forEach((d, i) => {
      const id = `${a.id}#${i + 1}`
      ids.push(id)
      b.acts.set(id, {
        ...a, id, duration: d, name: `${a.name} — ${segmentLabel(a.phase, i, n, profile.stories)}`,
        rationale: { ...a.rationale, summary: `${a.rationale.summary} ${long ? `Split into ${n} segments of ≤${MAX_FIELD_DURATION} work days (total ${a.duration}) so progress can be measured.` : `Split at the point where following trades can start (total ${a.duration} days).`}` },
      })
    })
    if (b.byCat.get(a.category) === a.id) b.byCat.set(a.category, ids[0])
    segs.set(a.id, ids)
    segDur.set(a.id, durs)
  }
  const flow: Rationale = { summary: 'Crew works through the segments in sequence.', sources: [src('template', 'Level 3 decomposition')], confidence: 'high' }
  for (const [orig, ids] of segs) for (let i = 1; i < ids.length; i++) b.link(ids[i - 1], ids[i], 'FS', 0, flow)

  const first = (id: string) => segs.get(id)?.[0] ?? id
  const last = (id: string) => { const s2 = segs.get(id); return s2 ? s2[s2.length - 1] : id }
  /** Segment of `id` in which cumulative work first reaches `days` (whole activity if not split). */
  const segmentAt = (id: string, days: number): string => {
    const ids = segs.get(id), durs = segDur.get(id)
    if (!ids || !durs) return id
    let cum = 0
    for (let i = 0; i < ids.length; i++) { cum += durs[i]; if (cum >= days) return ids[i] }
    return ids[ids.length - 1]
  }
  const durOf = (id: string) => segDur.get(id)?.reduce((x, y) => x + y, 0) ?? b.acts.get(id)?.duration ?? 0

  for (const l of [...b.links.values()]) {
    const touched = segs.has(l.from) || segs.has(l.to)
    const isLead = l.lag < 0
    const isLaggedSS = l.type === 'SS' && l.lag > 0
    if (!touched && !isLead && !isLaggedSS) continue
    b.links.delete(l.id)
    const note = (what: string): Rationale => ({ ...l.rationale, summary: `${l.rationale.summary} ${what}` })
    if (l.type === 'FS' && l.lag < 0) {
      // Lead (DCMA 2): start the successor after the segment in which the overlap begins.
      const from = segmentAt(l.from, durOf(l.from) + l.lag)
      b.link(from === l.from ? l.from : from, first(l.to), 'FS', 0, note(`(Template overlap of ${-l.lag}d restated as finish-to-start from the preceding segment; no leads.)`))
    } else if (isLaggedSS && segs.has(l.from)) {
      const P = segs.get(l.from)!, S = segs.get(l.to)
      if (S && S.length === P.length) {
        P.forEach((p, i) => b.link(p, S[i], 'FS', 0, note(`(Overlap SS+${l.lag}d restated level-by-level: each segment follows the same segment of the predecessor.)`)))
      } else {
        b.link(segmentAt(l.from, l.lag), first(l.to), 'FS', 0, note(`(Overlap SS+${l.lag}d restated as finish-to-start from the segment where ${l.lag} days of work are complete.)`))
      }
    } else if (l.type === 'FS') b.link(last(l.from), first(l.to), 'FS', l.lag, l.rationale)
    else if (l.type === 'FF') b.link(last(l.from), last(l.to), 'FF', l.lag, l.rationale)
    else if (l.type === 'SS') b.link(first(l.from), first(l.to), 'SS', l.lag, l.rationale)
    else b.link(first(l.from), last(l.to), 'SF', l.lag, l.rationale)
  }
}

function cpmOf(b: Builder, calendars: WorkCalendar[], start: string, mustFinishBy?: string): CpmResult {
  return runCpm({
    projectStart: start,
    activities: [...b.acts.values()],
    links: [...b.links.values()],
    calendars,
    defaultCalendarId: FIELD,
    mustFinishBy,
  })
}

function cpmSpan(cpm: CpmResult, start: string): number {
  // Approximate work days between start and finish (5/7 of calendar days).
  return Math.round(daysBetween(start, cpm.projectFinish) * 5 / 7)
}

function monthsBetween(a: string, b: string): number[] {
  const out: number[] = []
  let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7))
  const ey = Number(b.slice(0, 4)), em = Number(b.slice(5, 7))
  while (y < ey || (y === ey && m <= em)) {
    out.push(m)
    m++
    if (m > 12) { m = 1; y++ }
    if (out.length > 120) break
  }
  return out
}

function assignCodes(b: Builder, cpm: CpmResult) {
  const phaseOrder = ['preconstruction', 'design', 'permitting', 'procurement', 'sitework', 'structure', 'envelope', 'mep', 'interiors', 'commissioning', 'closeout']
  const list = [...b.acts.values()].sort((x, y) => {
    const tx = cpm.times[x.id]?.earlyStart || '9999', ty = cpm.times[y.id]?.earlyStart || '9999'
    return tx.localeCompare(ty) || phaseOrder.indexOf(x.phase) - phaseOrder.indexOf(y.phase) || x.id.localeCompare(y.id)
  })
  list.forEach((a, i) => { a.code = `A${1000 + i * 10}` })
}

function reapplyOverrides(b: Builder, prev: GeneratedSchedule | null | undefined): NonNullable<GeneratedSchedule['removed']> {
  if (!prev) return []
  const removed = [...(prev.removed || [])]
  // Activities the scheduler added survive regeneration (their links are carried below as user: links).
  for (const pa of prev.activities) if (pa.id.startsWith('user:act:') && !b.acts.has(pa.id)) b.acts.set(pa.id, { ...pa })
  for (const pa of prev.activities) {
    const cur = b.acts.get(pa.id)
    if (!cur || !pa.overrides?.length) continue
    cur.overrides = [...pa.overrides]
    for (const o of pa.overrides) {
      if (o.field === 'duration' && typeof o.to === 'number') {
        cur.duration = o.to
        cur.rationale = overriddenRationale(cur.rationale, o)
      }
      if (o.field === 'name' && typeof o.to === 'string') cur.name = o.to
    }
  }
  // Scheduler-added links survive regeneration.
  for (const pl of prev.links) {
    if (pl.id.startsWith('user:') && b.acts.has(pl.from) && b.acts.has(pl.to)) b.links.set(pl.id, { ...pl })
    const cur = b.links.get(pl.id)
    if (cur && pl.overrides?.length && !pl.id.startsWith('user:')) {
      cur.overrides = [...pl.overrides]
      for (const o of pl.overrides) {
        if (o.field === 'lag' && typeof o.to === 'number') cur.lag = o.to
        if (o.field === 'type' && typeof o.to === 'string') cur.type = o.to as LinkType
      }
      cur.rationale = overriddenRationale(cur.rationale, pl.overrides[pl.overrides.length - 1])
    }
  }
  for (const r of removed) {
    if (r.kind === 'activity') removeActivityBridging(b, r.id, r.override)
    else b.links.delete(r.id)
  }
  return removed
}

export function overriddenRationale(r: Rationale, o: Override): Rationale {
  return {
    summary: `Overridden by ${o.by}: ${o.reason} (was ${String(o.from)}; tool's reasoning: ${r.summary.replace(/^Overridden by[^(]*\(was[^;]*; tool's reasoning: /, '').replace(/\)$/, '')})`,
    sources: [{ kind: 'override', label: `Scheduler override by ${o.by}`, detail: o.at }, ...r.sources.filter(s => s.kind !== 'override')],
    confidence: 'high',
    assumptions: r.assumptions,
  }
}

/** Delete an activity and connect each predecessor to each successor so logic isn't broken. */
export function removeActivityBridging(b: { acts: Map<string, PlanActivity>; links: Map<string, PlanLink> }, id: string, o: Override) {
  if (!b.acts.has(id)) return
  const ins = [...b.links.values()].filter(l => l.to === id)
  const outs = [...b.links.values()].filter(l => l.from === id)
  for (const l of [...ins, ...outs]) b.links.delete(l.id)
  b.acts.delete(id)
  for (const i of ins) for (const o2 of outs) {
    const lid = `${i.from}>${o2.to}`
    if (i.from !== o2.to && !b.links.has(lid)) {
      b.links.set(lid, { id: lid, from: i.from, to: o2.to, type: 'FS', lag: 0, rationale: { summary: `Bridges logic around a removed activity (${o.reason}).`, sources: [{ kind: 'override', label: `Removal by ${o.by}`, detail: o.at }], confidence: 'medium' } })
    }
  }
}
