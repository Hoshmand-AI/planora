// PDF Schedule Parser
// Extracts text from PDF and attempts to identify schedule data

import { Activity } from '@/lib/db'
import { v4 as uuid } from 'uuid'

interface ParsedSchedule {
  projectName: string
  dataDate: string | null
  projectStart: string | null
  projectFinish: string | null
  activities: Activity[]
  relationships: never[]
}

export async function parsePDF(buffer: Buffer, scheduleId: string): Promise<ParsedSchedule> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse')
  const data = await pdfParse(buffer)
  const text = data.text
  
  // Try to extract project name from first few lines
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
  const projectName = lines[0] || 'Imported PDF Schedule'
  
  // Try to find dates in the text
  const dateRegex = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g
  const dates = text.match(dateRegex) || []
  
  // Try to extract activities from tabular data
  // Common patterns: ID | Name | Duration | Start | Finish
  const activities: Activity[] = []
  let actCount = 0
  
  for (const line of lines) {
    // Look for lines that might be activity rows
    // Typical: "A1234  Concrete Pour  5d  01/15/2026  01/20/2026"
    const parts = line.split(/\t|  +/)
    if (parts.length >= 3) {
      const possibleName = parts.find((p: string) => p.length > 5 && !/^\d+[\/\-]/.test(p) && !/^\d+d?$/.test(p))
      if (possibleName && actCount < 500) {
        const datesInLine = line.match(dateRegex) || []
        const durationMatch = line.match(/(\d+)\s*d/)
        
        actCount++
        activities.push({
          id: uuid(),
          scheduleId,
          activityId: `PDF-${actCount}`,
          name: possibleName.trim(),
          wbs: '',
          duration: durationMatch ? parseInt(durationMatch[1]) : 0,
          remainingDuration: durationMatch ? parseInt(durationMatch[1]) : 0,
          percentComplete: 0,
          earlyStart: datesInLine[0] ? parseFlexDate(datesInLine[0]) : null,
          earlyFinish: datesInLine[1] ? parseFlexDate(datesInLine[1]) : null,
          lateStart: null,
          lateFinish: null,
          actualStart: null,
          actualFinish: null,
          baselineStart: null,
          baselineFinish: null,
          totalFloat: 0,
          freeFloat: 0,
          isCritical: false,
          status: 'not_started',
          activityType: 'task',
        })
      }
    }
  }
  
  // If we couldn't parse activities, create a summary entry
  if (activities.length === 0) {
    activities.push({
      id: uuid(),
      scheduleId,
      activityId: 'PDF-SUMMARY',
      name: `PDF Schedule - ${lines.length} lines extracted`,
      wbs: '',
      duration: 0,
      remainingDuration: 0,
      percentComplete: 0,
      earlyStart: dates[0] ? parseFlexDate(dates[0]) : null,
      earlyFinish: dates[dates.length - 1] ? parseFlexDate(dates[dates.length - 1]) : null,
      lateStart: null,
      lateFinish: null,
      actualStart: null,
      actualFinish: null,
      baselineStart: null,
      baselineFinish: null,
      totalFloat: 0,
      freeFloat: 0,
      isCritical: false,
      status: 'not_started',
      activityType: 'summary',
    })
  }
  
  return {
    projectName,
    dataDate: null,
    projectStart: dates[0] ? parseFlexDate(dates[0]) : null,
    projectFinish: dates[dates.length - 1] ? parseFlexDate(dates[dates.length - 1]) : null,
    activities,
    relationships: [],
  }
}

function parseFlexDate(str: string): string | null {
  try {
    const d = new Date(str)
    if (isNaN(d.getTime())) return null
    return d.toISOString().split('T')[0]
  } catch {
    return null
  }
}
