// Primavera P6 XER File Parser
// XER is a tab-separated text format

import { Activity, Relationship } from '@/lib/db'
import { v4 as uuid } from 'uuid'

interface ParsedSchedule {
  projectName: string
  dataDate: string | null
  projectStart: string | null
  projectFinish: string | null
  activities: Activity[]
  relationships: Relationship[]
}

export function parseXER(content: string, scheduleId: string): ParsedSchedule {
  const lines = content.split('\n')
  let currentTable = ''
  let headers: string[] = []
  
  const tables: Record<string, Record<string, string>[]> = {}
  
  // Parse XER tab-separated format
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    
    if (trimmed.startsWith('%T')) {
      currentTable = trimmed.substring(3).trim()
      tables[currentTable] = []
    } else if (trimmed.startsWith('%F')) {
      headers = trimmed.substring(3).split('\t').map(h => h.trim())
    } else if (trimmed.startsWith('%R')) {
      const values = trimmed.substring(3).split('\t').map(v => v.trim())
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = values[i] || '' })
      if (tables[currentTable]) tables[currentTable].push(row)
    }
  }
  
  // Extract project info
  const projects = tables['PROJECT'] || []
  const project = projects[0] || {}
  const projectName = project['proj_short_name'] || project['proj_long_name'] || 'Imported Schedule'
  const dataDate = parseXERDate(project['last_recalc_date']) || parseXERDate(project['plan_start_date'])
  const projectStart = parseXERDate(project['plan_start_date'])
  const projectFinish = parseXERDate(project['plan_end_date']) || parseXERDate(project['scd_end_date'])
  
  // Parse activities from TASK table
  const tasks = tables['TASK'] || []
  const activities: Activity[] = tasks.map(t => {
    const pctComplete = parseFloat(t['phys_complete_pct'] || t['complete_pct'] || '0')
    const totalFloat = parseInt(t['total_float_hr_cnt'] || '0') / 8 // hours to days
    const freeFloat = parseInt(t['free_float_hr_cnt'] || '0') / 8
    
    let status: Activity['status'] = 'not_started'
    if (t['status_code'] === 'TK_Complete') status = 'complete'
    else if (t['status_code'] === 'TK_Active') status = 'in_progress'
    
    let actType: Activity['activityType'] = 'task'
    if (t['task_type'] === 'TT_Mile') actType = 'milestone'
    else if (t['task_type'] === 'TT_LOE') actType = 'loe'
    else if (t['task_type'] === 'TT_WBS') actType = 'summary'
    
    return {
      id: uuid(),
      scheduleId,
      activityId: t['task_code'] || t['task_id'] || '',
      name: t['task_name'] || 'Unnamed Activity',
      wbs: t['wbs_id'] || '',
      duration: parseInt(t['target_drtn_hr_cnt'] || '0') / 8,
      remainingDuration: parseInt(t['remain_drtn_hr_cnt'] || '0') / 8,
      percentComplete: pctComplete,
      earlyStart: parseXERDate(t['early_start_date']),
      earlyFinish: parseXERDate(t['early_end_date']),
      lateStart: parseXERDate(t['late_start_date']),
      lateFinish: parseXERDate(t['late_end_date']),
      actualStart: parseXERDate(t['act_start_date']),
      actualFinish: parseXERDate(t['act_end_date']),
      baselineStart: parseXERDate(t['target_start_date']),
      baselineFinish: parseXERDate(t['target_end_date']),
      totalFloat,
      freeFloat,
      isCritical: totalFloat <= 0 && status !== 'complete',
      status,
      activityType: actType,
    }
  })
  
  // Parse relationships from TASKPRED table
  const preds = tables['TASKPRED'] || []
  const relationships: Relationship[] = preds.map(p => {
    let relType: Relationship['type'] = 'FS'
    if (p['pred_type'] === 'PR_SS') relType = 'SS'
    else if (p['pred_type'] === 'PR_FF') relType = 'FF'
    else if (p['pred_type'] === 'PR_SF') relType = 'SF'
    
    return {
      id: uuid(),
      scheduleId,
      predecessorId: p['pred_task_id'] || '',
      successorId: p['task_id'] || '',
      type: relType,
      lag: parseInt(p['lag_hr_cnt'] || '0') / 8,
    }
  })
  
  return { projectName, dataDate, projectStart, projectFinish, activities, relationships }
}

function parseXERDate(dateStr: string | undefined): string | null {
  if (!dateStr || dateStr === '') return null
  try {
    // XER dates are typically "yyyy-mm-dd hh:mm" or similar
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return d.toISOString().split('T')[0]
  } catch {
    return null
  }
}
