// A sample hyperscale data center (60 MW, two data halls) as a P6 XER, dated around the day it is
// opened: long-lead electrical gear is late, the building is dry, commissioning is ahead. It comes with
// the correspondence and register a real job has, so the Daily Brief has everything to work with.
// Synthetic: no real project, owner or vendor. Pure (no I/O), so the browser builds it.

export const DC_SAMPLE_NAME = 'Sample: Hyperscale Data Center (60 MW)'

type Link = [code: string, type?: 'FS' | 'SS', lag?: number]
interface Row { code: string; name: string; wbs: string; dur: number; preds: Link[]; ms?: 'start' | 'finish' }

const WBS: [id: string, name: string][] = [
  ['PRE', 'Preconstruction and Long-Lead Procurement'], ['SITE', 'Site and Utilities'], ['SUB', 'Substation and Utility Power'],
  ['SHELL', 'Core and Shell'], ['ELEC', 'Electrical Systems'], ['MECH', 'Mechanical and Controls'],
  ['DH1', 'Data Hall 1 Fit-Out'], ['DH2', 'Data Hall 2 Fit-Out'], ['CX', 'Commissioning'], ['TURN', 'Turnover'],
]

const ROWS: Row[] = [
  { code: 'M1000', name: 'Notice to Proceed', wbs: 'PRE', dur: 0, preds: [], ms: 'start' },
  { code: 'P1010', name: 'Permits and Approvals', wbs: 'PRE', dur: 40, preds: [['M1000']] },
  { code: 'P1020', name: 'Procure Utility Transformers (Long Lead)', wbs: 'PRE', dur: 300, preds: [['M1000']] },
  { code: 'P1030', name: 'Procure Medium-Voltage Switchgear', wbs: 'PRE', dur: 285, preds: [['M1000']] },
  { code: 'P1040', name: 'Procure Generators (12 x 3 MW)', wbs: 'PRE', dur: 270, preds: [['M1000']] },
  { code: 'P1050', name: 'Procure UPS and Battery Systems', wbs: 'PRE', dur: 240, preds: [['M1000']] },
  { code: 'P1060', name: 'Procure Chillers and CRAH Units', wbs: 'PRE', dur: 250, preds: [['M1000']] },
  { code: 'P1070', name: 'Procure Busway and PDUs', wbs: 'PRE', dur: 230, preds: [['P1010']] },
  { code: 'S2010', name: 'Mass Grading and Erosion Control', wbs: 'SITE', dur: 30, preds: [['P1010']] },
  { code: 'S2020', name: 'Underground Utilities and Duct Banks', wbs: 'SITE', dur: 45, preds: [['S2010']] },
  { code: 'S2030', name: 'Site Fiber Entrance and Meet-Me Vaults', wbs: 'SITE', dur: 25, preds: [['S2020']] },
  { code: 'S2040', name: 'Paving, Security Fence and Guardhouse', wbs: 'SITE', dur: 40, preds: [['C3040']] },
  { code: 'U2510', name: 'Substation Civil and Foundations', wbs: 'SUB', dur: 50, preds: [['S2010']] },
  { code: 'U2520', name: 'Set Utility Transformers', wbs: 'SUB', dur: 15, preds: [['U2510'], ['P1020']] },
  { code: 'U2530', name: 'Utility Interconnect and Energization', wbs: 'SUB', dur: 30, preds: [['U2520']] },
  { code: 'C3010', name: 'Foundations and Slab on Grade', wbs: 'SHELL', dur: 50, preds: [['S2010']] },
  { code: 'C3020', name: 'Erect Structural Steel', wbs: 'SHELL', dur: 45, preds: [['C3010']] },
  { code: 'C3030', name: 'Roof Deck and Roofing', wbs: 'SHELL', dur: 30, preds: [['C3020']] },
  { code: 'C3040', name: 'Precast Wall Panels and Envelope', wbs: 'SHELL', dur: 40, preds: [['C3020']] },
  { code: 'C3050', name: 'Building Dry-In', wbs: 'SHELL', dur: 0, preds: [['C3030'], ['C3040']], ms: 'finish' },
  { code: 'E4010', name: 'Electrical Rooms Build-Out', wbs: 'ELEC', dur: 40, preds: [['C3050']] },
  { code: 'E4020', name: 'Set Medium-Voltage Switchgear', wbs: 'ELEC', dur: 20, preds: [['E4010'], ['P1030']] },
  { code: 'E4030', name: 'Set Generators and Fuel System', wbs: 'ELEC', dur: 30, preds: [['C3050'], ['P1040']] },
  { code: 'E4040', name: 'Install UPS and Batteries', wbs: 'ELEC', dur: 30, preds: [['E4010'], ['P1050']] },
  { code: 'E4045', name: 'Battery Room Ventilation and Hydrogen Detection', wbs: 'ELEC', dur: 25, preds: [['E4040']] },
  { code: 'E4047', name: 'Battery Commissioning and Discharge Test', wbs: 'ELEC', dur: 5, preds: [['E4045']] },
  { code: 'E4050', name: 'Install Busway and PDUs - Data Hall 1', wbs: 'DH1', dur: 35, preds: [['E4040'], ['P1070']] },
  { code: 'E4060', name: 'Pull and Terminate MV/LV Feeders', wbs: 'ELEC', dur: 35, preds: [['E4020']] },
  { code: 'M5010', name: 'Chilled Water Plant and Piping', wbs: 'MECH', dur: 60, preds: [['C3050']] },
  { code: 'M5020', name: 'Set Chillers and Cooling Towers', wbs: 'MECH', dur: 20, preds: [['M5010'], ['P1060']] },
  { code: 'M5030', name: 'Install CRAH Units - Data Hall 1', wbs: 'DH1', dur: 25, preds: [['M5020']] },
  { code: 'M5035', name: 'Chilled Water Flush and Fill', wbs: 'MECH', dur: 15, preds: [['M5020']] },
  { code: 'M5050', name: 'BMS and EPMS Controls', wbs: 'MECH', dur: 50, preds: [['M5020'], ['E4040']] },
  { code: 'D6005', name: 'Data Hall 1 Grounding Grid', wbs: 'DH1', dur: 10, preds: [['E4040', 'SS', 54]] },
  { code: 'D6010', name: 'Data Hall 1 Containment and Cable Tray', wbs: 'DH1', dur: 35, preds: [['E4050']] },
  { code: 'D6020', name: 'Data Hall 1 Structured Cabling and Fiber', wbs: 'DH1', dur: 25, preds: [['D6010'], ['D6005'], ['S2030']] },
  { code: 'D6510', name: 'Data Hall 2 Busway, PDUs and CRAH Units', wbs: 'DH2', dur: 45, preds: [['E4050'], ['M5030']] },
  { code: 'D6520', name: 'Data Hall 2 Containment and Cabling', wbs: 'DH2', dur: 35, preds: [['D6510']] },
  { code: 'X7010', name: 'Level 1-2 Factory Witness and Delivery Inspection', wbs: 'CX', dur: 20, preds: [['E4020'], ['E4030']] },
  { code: 'X7020', name: 'Level 3 Pre-Functional Checks and Startup', wbs: 'CX', dur: 30, preds: [['E4060'], ['M5030'], ['M5035'], ['E4047'], ['U2530'], ['X7010']] },
  { code: 'X7030', name: 'Level 4 Functional Performance Testing', wbs: 'CX', dur: 25, preds: [['X7020'], ['M5050']] },
  { code: 'X7040', name: 'Level 5 Integrated Systems Test (IST)', wbs: 'CX', dur: 15, preds: [['X7030'], ['D6020']] },
  { code: 'T8010', name: 'Ready for Service - Data Hall 1', wbs: 'TURN', dur: 0, preds: [['X7040']], ms: 'finish' },
  { code: 'T8020', name: 'Level 3-5 Commissioning - Data Hall 2', wbs: 'CX', dur: 35, preds: [['X7040'], ['D6520']] },
  { code: 'T8030', name: 'Punch List and Closeout', wbs: 'TURN', dur: 20, preds: [['T8020']] },
  { code: 'T8040', name: 'Substantial Completion', wbs: 'TURN', dur: 0, preds: [['T8030']], ms: 'finish' },
]

/** One crew per part of the job: its size (people working at once) and how many are available. */
const CREWS: Record<string, { name: string; size: number; max: number }> = {
  PRE: { name: 'Procurement and Expediting', size: 2, max: 6 }, SITE: { name: 'Civil Crew', size: 14, max: 30 }, SUB: { name: 'Utility and Substation Crew', size: 10, max: 20 },
  SHELL: { name: 'Structure and Envelope Crew', size: 24, max: 60 }, ELEC: { name: 'Electricians', size: 18, max: 40 }, MECH: { name: 'Mechanical and Controls Crew', size: 16, max: 40 },
  DH1: { name: 'Data Hall Fit-Out Crew', size: 20, max: 30 }, DH2: { name: 'Data Hall Fit-Out Crew', size: 20, max: 30 }, CX: { name: 'Commissioning Agents', size: 8, max: 16 }, TURN: { name: 'Closeout Crew', size: 6, max: 12 },
}
/** Equipment bought on the long-lead activities (US dollars), on top of the labor on each activity. */
const EQUIPMENT_COST: Record<string, number> = { P1020: 9_400_000, P1030: 6_200_000, P1040: 14_500_000, P1050: 8_300_000, P1060: 7_100_000, P1070: 3_900_000 }
const LABOR_RATE = 96 // dollars an hour, loaded

/** Work days from the start to the data date, and the work the vendors and crews still owe on that day. */
const DATA_DATE_INDEX = 300
const REMAINING_AT_DATA_DATE: Record<string, number> = {
  P1030: 18, // switchgear: the vendor slipped, and it now drives ready-for-service
  P1020: 1, // the transformers land today
  E4030: 8, E4050: 12, M5030: 12, M5050: 38,
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const isWork = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6
function shift(from: Date, workdays: number): Date {
  const d = new Date(from); let left = Math.abs(workdays); const step = workdays < 0 ? -1 : 1
  while (!isWork(d)) d.setUTCDate(d.getUTCDate() + step)
  while (left > 0) { d.setUTCDate(d.getUTCDate() + step); if (isWork(d)) left-- }
  return d
}

export interface DataCenterSample {
  fileName: string
  /** P6 XER text */
  xer: string
  dataDate: string
  requiredDate: string
  documents: { title: string; docType: 'meeting' | 'email' | 'daily_report' | 'contract' | 'specification'; text: string }[]
  register: { kind: 'risk' | 'issue' | 'pco' | 'change_order'; title: string; owner: string; dueInDays: number; impactDays: number | null; activityCodes: string[] }[]
}

export function dataCenterSample(today: string): DataCenterSample {
  const t = new Date(`${today.slice(0, 10)}T00:00:00Z`)
  // Updated this morning (on a weekend: the Friday before), so yesterday's actuals are in.
  const dd = new Date(t); while (!isWork(dd)) dd.setUTCDate(dd.getUTCDate() - 1)
  const start = shift(dd, -DATA_DATE_INDEX)
  const dayAt = (i: number) => iso(shift(start, i))
  const begins = (i: number) => `${dayAt(i)} 08:00`
  const ends = (i: number) => `${dayAt(Math.max(0, i - 1))} 17:00` // work on [es, ef) ends the evening before index ef

  const byCode = new Map(ROWS.map(r => [r.code, r]))
  // Baseline pass, then the current pass (retained logic: remaining work starts no earlier than the data date).
  const bl = new Map<string, { es: number; ef: number }>()
  const cur = new Map<string, { es: number; ef: number; rem: number; status: 'TK_Complete' | 'TK_Active' | 'TK_NotStart' }>()
  const after = (m: Map<string, { es: number; ef: number }>, r: Row, floor: number) =>
    r.preds.reduce((v, [c, type = 'FS', lag = 0]) => Math.max(v, (type === 'SS' ? m.get(c)!.es : m.get(c)!.ef) + lag), floor)
  // Predecessors first, whatever order the list is written in.
  const ordered: Row[] = []
  const visit = (r: Row) => { if (ordered.includes(r)) return; r.preds.forEach(([c]) => visit(byCode.get(c)!)); ordered.push(r) }
  ROWS.forEach(visit)
  for (const r of ordered) { const es = after(bl, r, 0); bl.set(r.code, { es, ef: es + r.dur }) }
  for (const r of ordered) {
    const b = bl.get(r.code)!
    const owed = REMAINING_AT_DATA_DATE[r.code]
    if (owed == null && b.ef <= DATA_DATE_INDEX && r.preds.every(([c]) => cur.get(c)!.status === 'TK_Complete')) { cur.set(r.code, { es: b.es, ef: b.ef, rem: 0, status: 'TK_Complete' }); continue }
    if (owed != null || (b.es < DATA_DATE_INDEX && r.dur > 0 && r.preds.every(([c]) => cur.get(c)!.status === 'TK_Complete'))) {
      const rem = owed ?? Math.max(1, b.ef - DATA_DATE_INDEX)
      cur.set(r.code, { es: b.es, ef: DATA_DATE_INDEX + rem, rem, status: 'TK_Active' }); continue
    }
    const es = after(cur, r, DATA_DATE_INDEX)
    cur.set(r.code, { es, ef: es + r.dur, rem: r.dur, status: 'TK_NotStart' })
  }
  // The contract dates are the baseline ones: ready for service for Data Hall 1, then substantial completion.
  const rfs = bl.get('T8010')!.ef
  const required = dayAt(rfs - 1)

  const wbsId = (w: string) => 20 + WBS.findIndex(x => x[0] === w)
  const taskId = (code: string) => 5000 + ROWS.findIndex(r => r.code === code)
  const shiftBlock = '(0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())'
  const clndr = `(0||CalendarData()((0||DaysOfWeek()((0||1()())${[2, 3, 4, 5, 6].map(d => `(0||${d}()(${shiftBlock}))`).join('')}(0||7()())))(0||Exceptions()())))`
  const L: string[] = []
  const table = (name: string, fields: string[], rows: (string | number)[][]) => { L.push(`%T\t${name}`, `%F\t${fields.join('\t')}`, ...rows.map(r => `%R\t${r.join('\t')}`)) }
  L.push(`ERMHDR\t19.12\t${iso(dd)}\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tUSD`)
  table('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'last_chng_date', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'month_hr_cnt', 'year_hr_cnt', 'rsrc_private', 'clndr_data'],
    [[100, 'Y', '5 Day x 8h', '', '', '', 'CA_Base', 8, 40, 172, 2000, 'N', clndr]])
  table('PROJECT', ['proj_id', 'proj_short_name', 'clndr_id', 'plan_start_date', 'plan_end_date', 'scd_end_date', 'last_recalc_date'],
    [[1, DC_SAMPLE_NAME, 100, `${iso(start)} 00:00`, `${dayAt(bl.get('T8040')!.ef - 1)} 17:00`, ends(cur.get('T8040')!.ef), `${iso(dd)} 00:00`]])
  table('PROJWBS', ['wbs_id', 'proj_id', 'obs_id', 'seq_num', 'proj_node_flag', 'status_code', 'wbs_short_name', 'wbs_name', 'parent_wbs_id'],
    [[10, 1, '', '', 'Y', '', 'DC60', DC_SAMPLE_NAME, ''], ...WBS.map(([id, name], i) => [20 + i, 1, '', i + 1, 'N', '', id, name, 10])])
  table('TASK', ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'complete_pct_type', 'task_type', 'status_code', 'task_code', 'task_name', 'total_float_hr_cnt', 'free_float_hr_cnt', 'remain_drtn_hr_cnt', 'target_drtn_hr_cnt', 'cstr_date', 'act_start_date', 'act_end_date', 'late_start_date', 'late_end_date', 'early_start_date', 'early_end_date', 'target_start_date', 'target_end_date', 'cstr_type', 'driving_path_flag'],
    ROWS.map(r => {
      const b = bl.get(r.code)!, c = cur.get(r.code)!
      const type = r.ms === 'start' ? 'TT_Mile' : r.ms === 'finish' ? 'TT_FinMile' : 'TT_Task'
      const at = (i: number, end: boolean) => (r.ms === 'start' ? begins(i) : r.ms === 'finish' || end ? ends(i) : begins(i))
      const pct = c.status === 'TK_Complete' ? 100 : c.status === 'TK_Active' ? Math.max(5, Math.min(95, Math.round(100 * (1 - c.rem / Math.max(r.dur, c.rem + 1))))) : 0
      const isRfs = r.code === 'T8010'
      return [taskId(r.code), 1, wbsId(r.wbs), 100, pct, 'CP_Phys', type, c.status, r.code, r.name, '', '', c.rem * 8, r.dur * 8,
        isRfs ? `${required} 17:00` : '',
        c.status === 'TK_NotStart' ? '' : at(c.es, false), c.status === 'TK_Complete' ? at(c.ef, true) : '',
        '', '', c.status === 'TK_Complete' ? '' : at(c.status === 'TK_Active' ? DATA_DATE_INDEX : c.es, false), c.status === 'TK_Complete' ? '' : at(c.ef, true),
        at(b.es, false), at(b.ef, true), isRfs ? 'CS_MEOB' : '', '']
    }))
  let n = 0
  table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'],
    ROWS.flatMap(r => r.preds.map(([c, type = 'FS', lag = 0]) => [++n, taskId(r.code), taskId(c), 1, 1, `PR_${type}`, lag * 8])))
  // Resources and costs: one crew per activity, with budget, actual and remaining cost, so resource loading and earned value have data.
  const crewIds = [...new Set(Object.values(CREWS).map(c => c.name))]
  const rid = (w: string) => 900 + crewIds.indexOf(CREWS[w].name)
  table('CURRTYPE', ['curr_id', 'decimal_digit_cnt', 'curr_symbol', 'decimal_symbol', 'curr_type', 'curr_short_name', 'base_exch_rate'], [[1, 2, '$', '.', 'US Dollar', 'USD', 1]])
  table('RSRC', ['rsrc_id', 'rsrc_short_name', 'rsrc_name', 'rsrc_type'], crewIds.map((nm, i) => [900 + i, nm.split(' ')[0].toUpperCase(), nm, 'RT_Labor']))
  table('RSRCRATE', ['rsrc_rate_id', 'rsrc_id', 'max_qty_per_hr', 'cost_per_qty', 'start_date'], crewIds.map((nm, i) => [950 + i, 900 + i, Math.max(...Object.values(CREWS).filter(c => c.name === nm).map(c => c.max)), LABOR_RATE, `${iso(start)} 00:00`]))
  let ar = 0
  table('TASKRSRC', ['taskrsrc_id', 'task_id', 'proj_id', 'rsrc_id', 'target_qty', 'target_qty_per_hr', 'remain_qty', 'remain_qty_per_hr', 'act_reg_qty', 'act_ot_qty', 'target_cost', 'act_reg_cost', 'act_ot_cost', 'remain_cost'],
    ROWS.filter(r => !r.ms).map(r => {
      const c = cur.get(r.code)!, crew = CREWS[r.wbs]
      const hours = r.dur * 8 * crew.size, remHours = c.rem * 8 * crew.size
      const done = c.status === 'TK_Complete' ? 1 : c.status === 'TK_Active' ? Math.max(0, 1 - c.rem / Math.max(r.dur, c.rem)) : 0
      const budget = hours * LABOR_RATE + (EQUIPMENT_COST[r.code] ?? 0)
      // Work that ran late cost more than planned: the overrun shows in the actual and the remaining cost.
      const late = REMAINING_AT_DATA_DATE[r.code] != null ? 1.09 : 1.02
      const actual = Math.round(budget * done * late), remain = Math.round(budget * (1 - done) * late)
      return [++ar, taskId(r.code), 1, rid(r.wbs), hours, crew.size, remHours, c.status === 'TK_Complete' ? 0 : crew.size, Math.round(hours * done), 0, Math.round(budget), actual, 0, remain]
    }))
  L.push('%E')

  const us = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
  const last = iso(shift(dd, -1))
  return {
    fileName: 'Hyperscale-Data-Center-60MW.xer', xer: L.join('\r\n') + '\r\n', dataDate: iso(dd), requiredDate: required,
    documents: [
      { title: `OAC meeting minutes ${us(last)}`, docType: 'meeting', text: [
        `Owner-Architect-Contractor meeting, ${us(last)}. Attendees: owner's representative, general contractor, electrical subcontractor, commissioning agent.`,
        'Item 1. The electrical subcontractor reported that the medium-voltage switchgear will be delayed by 3 weeks because the vendor failed the factory breaker test. A revised ship date is expected Friday.',
        'Item 2. The utility has not confirmed the energization date. The interconnect outage window is at risk if the transformers are not set this month.',
        'Item 3. The owner requested additional hot-aisle containment in Data Hall 2; the contractor will price it as a change order and expects it to add 5 days to the containment work.',
        'Item 4. The commissioning agent will issue the Level 3 pre-functional checklists by next Wednesday.',
        'Item 5. Next meeting same time next week.',
      ].join('\n\n') },
      { title: 'Email: generator fuel system inspection', docType: 'email', text: [
        'From: mechanical subcontractor project manager. To: general contractor superintendent. Subject: Generator fuel system inspection.',
        'The fire marshal inspection of the generator fuel system is on hold pending the revised tank venting detail from the engineer. We cannot fill the tanks until it passes.',
        'We will have the remaining four generators set by end of next week if the crane stays on site.',
      ].join('\n\n') },
      { title: `Daily field report ${us(last)}`, docType: 'daily_report', text: [
        `Daily field report, ${us(last)}. Weather clear. 212 workers on site.`,
        'Busway installation in Data Hall 1 continued on rows A through D. CRAH units 9 through 14 were set.',
        'The crew started Data Hall 1 containment and cable tray in row A ahead of the busway.',
        'BMS controls pulling is behind schedule in the electrical rooms because the conduit was not released; the crew lost 2 days.',
        'No safety incidents.',
      ].join('\n\n') },
      { title: 'Contract excerpt: time and schedule', docType: 'contract', text: [
        'ARTICLE 8. TIME.',
        '8.2 The Contractor shall give the Owner written notice of any delay or change affecting the Contract Time within seven (7) days of the event giving rise to it. Failure to give notice waives the claim.',
        '8.4 If Ready for Service of Data Hall 1 is not achieved by the required date, the Contractor shall pay liquidated damages of $50,000 per day for each calendar day of delay.',
        '8.6 The Contractor shall submit an updated schedule monthly with each application for payment.',
        '8.7 Float is not for the exclusive use of either party and belongs to the project.',
      ].join('\n\n') },
      { title: 'Specification 21 13 00 and 28 31 00 excerpt', docType: 'specification', text: [
        'SECTION 21 13 00. Each data hall and electrical room shall be protected by a double-interlock pre-action sprinkler system.',
        'SECTION 28 31 00. Provide aspirating smoke detection (VESDA) in each data hall, tied to the fire alarm system, and test it before the integrated systems test.',
      ].join('\n\n') },
    ],
    register: [
      { kind: 'risk', title: 'Utility has not confirmed the energization date', owner: 'Owner’s representative', dueInDays: 10, impactDays: 10, activityCodes: ['U2530'] },
      { kind: 'issue', title: 'Generator fuel system inspection on hold for the venting detail', owner: 'Mechanical subcontractor', dueInDays: -2, impactDays: null, activityCodes: ['E4030'] },
      { kind: 'pco', title: 'PCO-014 Additional hot-aisle containment in Data Hall 2', owner: 'General contractor', dueInDays: 7, impactDays: 5, activityCodes: ['D6520'] },
      { kind: 'change_order', title: 'CO-006 Second fiber entrance for the meet-me room', owner: 'Owner', dueInDays: 14, impactDays: null, activityCodes: ['S2030'] },
    ],
  }
}
