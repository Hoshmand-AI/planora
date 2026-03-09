// Microsoft Project XML Parser

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

export function parseMSProjectXML(content: string, scheduleId: string): ParsedSchedule {
  // Simple XML parsing without external dependency
  const getTag = (xml: string, tag: string): string => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 's'))
    return match ? match[1].trim() : ''
  }
  
  const getAllTags = (xml: string, tag: string): string[] => {
    const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'gs')
    const results: string[] = []
    let m
    while ((m = regex.exec(xml)) !== null) results.push(m[1])
    return results
  }
  
  // Project info
  const projectName = getTag(content, 'Name') || getTag(content, 'Title') || 'Imported Schedule'
  const projectStart = parseDate(getTag(content, 'StartDate') || getTag(content, 'CreationDate'))
  const projectFinish = parseDate(getTag(content, 'FinishDate'))
  const dataDate = parseDate(getTag(content, 'StatusDate') || getTag(content, 'CurrentDate'))
  
  // Parse tasks
  const taskBlocks = getAllTags(content, 'Task')
  const activities: Activity[] = []
  const taskUIDMap: Record<string, string> = {} // UID -> activityId for relationship mapping
  
  for (const block of taskBlocks) {
    const uid = getTag(block, 'UID')
    const name = getTag(block, 'Name')
    const taskId = getTag(block, 'ID') || uid
    
    if (!name || name === '') continue
    
    // Skip summary tasks (OutlineLevel 0 is project summary)
    const outlineLevel = parseInt(getTag(block, 'OutlineLevel') || '0')
    const isSummary = getTag(block, 'Summary') === '1'
    
    const duration = parseDuration(getTag(block, 'Duration'))
    const remainDuration = parseDuration(getTag(block, 'RemainingDuration'))
    const pctComplete = parseInt(getTag(block, 'PercentComplete') || '0')
    const isMilestone = getTag(block, 'Milestone') === '1'
    
    const totalSlack = parseDuration(getTag(block, 'TotalSlack'))
    const freeSlack = parseDuration(getTag(block, 'FreeSlack'))
    const isCritical = getTag(block, 'Critical') === '1' || totalSlack <= 0
    
    let status: Activity['status'] = 'not_started'
    if (pctComplete >= 100) status = 'complete'
    else if (pctComplete > 0 || getTag(block, 'ActualStart')) status = 'in_progress'
    
    const actId = uuid()
    taskUIDMap[uid] = actId
    
    activities.push({
      id: actId,
      scheduleId,
      activityId: `A${taskId}`,
      name,
      wbs: getTag(block, 'WBS') || getTag(block, 'OutlineNumber') || '',
      duration,
      remainingDuration: remainDuration,
      percentComplete: pctComplete,
      earlyStart: parseDate(getTag(block, 'Start') || getTag(block, 'EarlyStart')),
      earlyFinish: parseDate(getTag(block, 'Finish') || getTag(block, 'EarlyFinish')),
      lateStart: parseDate(getTag(block, 'LateStart')),
      lateFinish: parseDate(getTag(block, 'LateFinish')),
      actualStart: parseDate(getTag(block, 'ActualStart')),
      actualFinish: parseDate(getTag(block, 'ActualFinish')),
      baselineStart: parseDate(getTag(block, 'BaselineStart')),
      baselineFinish: parseDate(getTag(block, 'BaselineFinish')),
      totalFloat: totalSlack,
      freeFloat: freeSlack,
      isCritical,
      status,
      activityType: isMilestone ? 'milestone' : isSummary ? 'summary' : 'task',
    })
    
    // Parse predecessor links inside this task
    const predLinks = getAllTags(block, 'PredecessorLink')
    for (const link of predLinks) {
      const predUID = getTag(link, 'PredecessorUID')
      let relType: Relationship['type'] = 'FS'
      const typeVal = getTag(link, 'Type')
      if (typeVal === '0') relType = 'FF'
      else if (typeVal === '1') relType = 'FS'
      else if (typeVal === '2') relType = 'SF'
      else if (typeVal === '3') relType = 'SS'
      
    // Predecessor links parsed below after all tasks are collected
    }
  }
  
  // Parse relationships with resolved UIDs
  const relationships: Relationship[] = []
  // Re-parse for relationships since we need the full task list first
  for (const block of taskBlocks) {
    const uid = getTag(block, 'UID')
    const predLinks = getAllTags(block, 'PredecessorLink')
    for (const link of predLinks) {
      const predUID = getTag(link, 'PredecessorUID')
      let relType: Relationship['type'] = 'FS'
      const typeVal = getTag(link, 'Type')
      if (typeVal === '0') relType = 'FF'
      else if (typeVal === '1') relType = 'FS'
      else if (typeVal === '2') relType = 'SF'
      else if (typeVal === '3') relType = 'SS'
      
      relationships.push({
        id: uuid(),
        scheduleId,
        predecessorId: taskUIDMap[predUID] || predUID,
        successorId: taskUIDMap[uid] || uid,
        type: relType,
        lag: parseDuration(getTag(link, 'LinkLag')),
      })
    }
  }
  
  return { projectName, dataDate, projectStart, projectFinish, activities, relationships }
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr || dateStr === '') return null
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return d.toISOString().split('T')[0]
  } catch {
    return null
  }
}

function parseDuration(durStr: string | undefined): number {
  if (!durStr || durStr === '') return 0
  // MS Project duration format: PT8H0M0S or P5D etc
  const dayMatch = durStr.match(/(\d+)D/)
  const hourMatch = durStr.match(/(\d+)H/)
  let days = dayMatch ? parseInt(dayMatch[1]) : 0
  if (hourMatch) days += parseInt(hourMatch[1]) / 8
  // If just a number, treat as days
  if (!dayMatch && !hourMatch) {
    const num = parseInt(durStr)
    if (!isNaN(num)) return num
  }
  return days
}
