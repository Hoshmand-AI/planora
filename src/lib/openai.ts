import OpenAI from 'openai'
import { Activity, Relationship, Schedule } from '@/lib/db'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
})

interface ScheduleContext {
  schedule: Schedule
  activities: Activity[]
  relationships: Relationship[]
}

export async function askScheduleQuestion(
  question: string,
  context: ScheduleContext
): Promise<string> {
  // Build smart context — don't send all activities, just relevant ones
  const { schedule, activities, relationships } = context
  
  const criticalActivities = activities.filter(a => a.isCritical).slice(0, 30)
  const nearTermActivities = activities
    .filter(a => a.status !== 'complete' && a.earlyStart)
    .sort((a, b) => (a.earlyStart || '').localeCompare(b.earlyStart || ''))
    .slice(0, 20)
  
  const stats = {
    totalActivities: activities.length,
    criticalCount: activities.filter(a => a.isCritical).length,
    completedCount: activities.filter(a => a.status === 'complete').length,
    inProgressCount: activities.filter(a => a.status === 'in_progress').length,
    notStartedCount: activities.filter(a => a.status === 'not_started').length,
    avgFloat: activities.length > 0
      ? (activities.reduce((sum, a) => sum + a.totalFloat, 0) / activities.length).toFixed(1)
      : '0',
    zeroFloatCount: activities.filter(a => a.totalFloat <= 0 && a.status !== 'complete').length,
    negativeFloatCount: activities.filter(a => a.totalFloat < 0).length,
    totalRelationships: relationships.length,
    missingPredecessors: findMissingPredecessors(activities, relationships).length,
    missingSuccessors: findMissingSuccessors(activities, relationships).length,
  }
  
  const systemPrompt = `You are an expert construction schedule analyst working for Planora. You analyze Primavera P6 and MS Project schedules with precision.

RULES:
- Use exact data from the schedule. Never guess or make up activity names, dates, or float values.
- Be formal and professional. Use construction scheduling terminology correctly.
- When discussing critical path, explain WHY activities are critical (zero or negative float).
- When discussing delays, identify the driving activities and their predecessors.
- Provide actionable recommendations when relevant.
- Format responses clearly with sections and bullet points when appropriate.
- If the data doesn't contain enough information to answer, say so clearly.

SCHEDULE: ${schedule.name} (${schedule.version})
Data Date: ${schedule.dataDate || 'Not specified'}
Project Start: ${schedule.projectStart || 'Not specified'}
Project Finish: ${schedule.projectFinish || 'Not specified'}
Variance: ${schedule.varianceDays !== null ? schedule.varianceDays + ' days' : 'Not calculated'}

STATISTICS:
- Total Activities: ${stats.totalActivities}
- Critical Activities: ${stats.criticalCount} (${((stats.criticalCount / Math.max(stats.totalActivities, 1)) * 100).toFixed(1)}%)
- Completed: ${stats.completedCount} | In Progress: ${stats.inProgressCount} | Not Started: ${stats.notStartedCount}
- Average Float: ${stats.avgFloat} days
- Zero Float Activities: ${stats.zeroFloatCount}
- Negative Float Activities: ${stats.negativeFloatCount}
- Total Relationships: ${stats.totalRelationships}
- Missing Predecessors: ${stats.missingPredecessors}
- Missing Successors: ${stats.missingSuccessors}

CRITICAL PATH ACTIVITIES (top 30):
${criticalActivities.map(a => `- ${a.activityId}: ${a.name} | Duration: ${a.duration}d | Float: ${a.totalFloat}d | Start: ${a.earlyStart} | Finish: ${a.earlyFinish} | Status: ${a.status} | Complete: ${a.percentComplete}%`).join('\n')}

NEAR-TERM ACTIVITIES (next 20 by start date):
${nearTermActivities.map(a => `- ${a.activityId}: ${a.name} | Duration: ${a.duration}d | Float: ${a.totalFloat}d | Start: ${a.earlyStart} | Finish: ${a.earlyFinish} | Status: ${a.status} | Critical: ${a.isCritical}`).join('\n')}
`

  // Check for specific activity queries
  const activityMatch = question.match(/(?:task|activity)\s+([A-Za-z0-9\-_.]+)/i)
  let extraContext = ''
  
  if (activityMatch) {
    const searchId = activityMatch[1]
    const found = activities.find(a => 
      a.activityId.toLowerCase() === searchId.toLowerCase() ||
      a.activityId.toLowerCase().includes(searchId.toLowerCase())
    )
    if (found) {
      const preds = relationships.filter(r => r.successorId === found.id || r.successorId === found.activityId)
      const succs = relationships.filter(r => r.predecessorId === found.id || r.predecessorId === found.activityId)
      
      extraContext = `\nSPECIFIC ACTIVITY DETAIL:
Activity ID: ${found.activityId}
Name: ${found.name}
WBS: ${found.wbs}
Duration: ${found.duration} days | Remaining: ${found.remainingDuration} days
% Complete: ${found.percentComplete}%
Early Start: ${found.earlyStart} | Early Finish: ${found.earlyFinish}
Late Start: ${found.lateStart} | Late Finish: ${found.lateFinish}
Actual Start: ${found.actualStart} | Actual Finish: ${found.actualFinish}
Baseline Start: ${found.baselineStart} | Baseline Finish: ${found.baselineFinish}
Total Float: ${found.totalFloat} days | Free Float: ${found.freeFloat} days
Critical: ${found.isCritical} | Status: ${found.status}
Predecessors: ${preds.length} | Successors: ${succs.length}
`
    }
  }
  
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt + extraContext },
        { role: 'user', content: question },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    })
    
    return completion.choices[0]?.message?.content || 'Unable to generate a response. Please try again.'
  } catch (error: unknown) {
    const err = error as Error
    console.error('OpenAI error:', err.message)
    
    if (err.message?.includes('API key')) {
      return 'OpenAI API key is not configured. Please add your OPENAI_API_KEY to the environment variables.'
    }
    
    return `AI analysis temporarily unavailable. Error: ${err.message}`
  }
}

function findMissingPredecessors(activities: Activity[], relationships: Relationship[]): Activity[] {
  const successorIds = new Set(relationships.map(r => r.successorId))
  return activities.filter(a => 
    a.status !== 'complete' && 
    a.activityType === 'task' && 
    !successorIds.has(a.id) && 
    !successorIds.has(a.activityId)
  )
}

function findMissingSuccessors(activities: Activity[], relationships: Relationship[]): Activity[] {
  const predecessorIds = new Set(relationships.map(r => r.predecessorId))
  return activities.filter(a => 
    a.activityType === 'task' && 
    !predecessorIds.has(a.id) && 
    !predecessorIds.has(a.activityId)
  )
}

export async function generateReport(
  reportType: string,
  context: ScheduleContext
): Promise<string> {
  const { schedule, activities, relationships } = context
  
  const stats = {
    total: activities.length,
    critical: activities.filter(a => a.isCritical).length,
    complete: activities.filter(a => a.status === 'complete').length,
    inProgress: activities.filter(a => a.status === 'in_progress').length,
    notStarted: activities.filter(a => a.status === 'not_started').length,
    missingPred: findMissingPredecessors(activities, relationships).length,
    missingSucc: findMissingSuccessors(activities, relationships).length,
    negFloat: activities.filter(a => a.totalFloat < 0).length,
  }
  
  const prompts: Record<string, string> = {
    executive_summary: `Generate a formal Executive Schedule Summary report for the ${schedule.name} project. Include:
1. Executive Narrative (2-3 paragraphs summarizing status)
2. Schedule Status (key dates, variance, completion %)
3. Key Findings (5-7 bullet points)
4. Near-Term Outlook (activities starting in next 14 days)
5. Recommendations (3-5 actionable items)
Use formal, professional language suitable for presentation to project executives.`,
    
    critical_path: `Generate a Critical Path Analysis report for ${schedule.name}. Include:
1. Critical Path Summary (total critical activities, % of schedule)
2. Critical Path Sequence (list the driving activities in order)
3. Near-Critical Paths (activities within 5 days of critical)
4. Float Consumption Analysis
5. Recommendations for critical path management`,
    
    variance: `Generate a Baseline vs Current Variance report for ${schedule.name}. Include:
1. Overall Variance Summary (days early/late)
2. Milestone Comparison (key milestones with baseline vs forecast dates)
3. Variance Categories (what's driving the variance)
4. Recovery Options (if project is late)
5. Recommendations`,
    
    qa_qc: `Generate a Schedule QA/QC Audit report for ${schedule.name} based on DCMA 14-Point Assessment standards. Include:
1. Overall Quality Score
2. Logic Analysis (missing predecessors: ${stats.missingPred}, missing successors: ${stats.missingSucc})
3. Float Analysis (negative float: ${stats.negFloat})
4. Constraint Analysis
5. Relationship Type Distribution
6. Specific Findings and Fixes`,
  }
  
  const prompt = prompts[reportType] || prompts.executive_summary
  
  const contextStr = `Schedule: ${schedule.name} | Version: ${schedule.version}
Data Date: ${schedule.dataDate} | Start: ${schedule.projectStart} | Finish: ${schedule.projectFinish}
Activities: ${stats.total} | Critical: ${stats.critical} | Complete: ${stats.complete}
In Progress: ${stats.inProgress} | Not Started: ${stats.notStarted}
Variance: ${schedule.varianceDays || 'Unknown'} days
Missing Predecessors: ${stats.missingPred} | Missing Successors: ${stats.missingSucc}
Negative Float: ${stats.negFloat}

Top Critical Activities:
${activities.filter(a => a.isCritical).slice(0, 20).map(a => `- ${a.activityId}: ${a.name} (${a.duration}d, float: ${a.totalFloat}d, ${a.earlyStart} to ${a.earlyFinish})`).join('\n')}
`

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: `You are a senior construction scheduling consultant generating a formal report. Write in professional, formal language. Use proper section numbering. Include specific data from the schedule. This report should be suitable for presentation to project executives and could be used in contractual or claims contexts.\n\nSCHEDULE DATA:\n${contextStr}` 
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 3000,
    })
    
    return completion.choices[0]?.message?.content || 'Unable to generate report.'
  } catch (error: unknown) {
    const err = error as Error
    return `Report generation failed: ${err.message}`
  }
}
