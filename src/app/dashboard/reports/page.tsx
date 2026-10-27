'use client'

import { useEffect, useId, useState } from 'react'
import { useApp } from '../layout'
import { BarChart3, Activity, FileText, CheckCircle, Download, X, Loader2 } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { fmtDateTime } from '@/lib/format'
import { Markdown } from '@/components/Markdown'

const REPORT_TYPES = [
  { id: 'executive_summary', icon: BarChart3,   title: 'Executive Schedule Summary',    desc: 'High-level narrative with status, variance, key findings, and recommendations.' },
  { id: 'critical_path',     icon: Activity,    title: 'Critical & Near-Critical Paths', desc: 'Driving activities, float consumption, path sequences, and near-critical analysis.' },
  { id: 'variance',          icon: FileText,    title: 'Baseline vs Current Variance',   desc: 'Milestone-by-milestone comparison with variance breakdown and cause categories.' },
  { id: 'qa_qc',             icon: CheckCircle, title: 'Schedule QA/QC Audit',           desc: 'DCMA 14-point compliance check with logic issues and specific fixes.' },
]

type AiMode = 'cloud' | 'local' | 'offline'

/** What actually writes the report, from the deployment's AI mode and the organization's AI setting (/api/system). */
function reportMethod(llm: { mode: AiMode; error?: string } | null): string {
  if (!llm) return 'Select a report type to generate a report'
  if (llm.mode === 'cloud') return 'Select a report type to generate a narrative written by the cloud AI model from the computed schedule facts'
  if (llm.mode === 'local') return 'Select a report type to generate a narrative written by your on-prem AI model from the computed schedule facts'
  return `AI is offline${llm.error ? ` (${llm.error.replace(/\.$/, '')})` : ''}, so reports are built by Hoshmand Schedule's rules directly from the schedule data, with no AI model. Select a report type`
}

export default function ReportsPage() {
  const { selectedSchedule, openUpload, can } = useApp()
  const [llm, setLlm] = useState<{ mode: AiMode; error?: string } | null>(null)
  useEffect(() => { fetch('/api/system').then(r => r.json()).then(d => setLlm(d.llm || null)).catch(() => {}) }, [])
  const [generating, setGenerating] = useState<string | null>(null)
  const [useDocs, setUseDocs] = useState(false)
  const [withUnreviewed, setWithUnreviewed] = useState(false)
  const docsId = useId()
  const unrevId = useId()
  const [report, setReport] = useState<{ type: string; content: string; scheduleName: string; generatedAt: string } | null>(null)

  const handleGenerate = async (reportType: string) => {
    if (!selectedSchedule) return
    setGenerating(reportType)
    setReport(null)
    try {
      const res  = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType, scheduleId: selectedSchedule.id, ...(useDocs ? { useDocuments: true, includeUnreviewed: withUnreviewed } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      setReport({
        type: reportType,
        content: data.content || data.error || 'Report generation failed.',
        scheduleName: data.scheduleName,
        generatedAt: data.generatedAt,
      })
    } catch {
      setReport({ type: reportType, content: 'Network error. Please try again.', scheduleName: '', generatedAt: '' })
    }
    setGenerating(null)
  }

  const handleExport = () => {
    if (!report) return
    const blob = new Blob([report.content], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${report.scheduleName || 'report'}-${report.type}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!selectedSchedule) {
    return (
      <EmptyState title="Upload a schedule to generate reports" action={{ label: can('schedule.write') ? 'Upload a schedule' : 'Build a schedule', onClick: openUpload }}>
        Professional narrative reports based on your actual schedule data.
      </EmptyState>
    )
  }

  if (report) {
    const rt = REPORT_TYPES.find(r => r.id === report.type)
    const Icon = rt?.icon || FileText
    return (
      <div className="p-5 md:p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-navy-900 rounded-md flex items-center justify-center">
              <Icon size={14} className="text-accent-400" aria-hidden />
            </div>
            <h2 className="font-display text-[20px] text-navy-950">{rt?.title}</h2>
          </div>
          <button onClick={() => setReport(null)} aria-label="Close report" className="text-warm-500 hover:text-warm-700"><X size={18} aria-hidden /></button>
        </div>

        <div className="bg-warm-100 border border-warm-200 rounded-md p-3 mb-4 flex items-center justify-between">
          <div className="text-[12px] text-warm-500">
            {report.scheduleName} · Generated {report.generatedAt ? fmtDateTime(report.generatedAt) : ''}
          </div>
          <button onClick={handleExport} className="flex items-center gap-1.5 text-accent-600 text-[12px] font-medium hover:underline">
            <Download size={13} aria-hidden /> Download (.md)
          </button>
        </div>

        <div className="bg-warm-50 border border-warm-200 rounded-lg p-6 md:p-8">
          <Markdown text={report.content} className="text-[14px] text-warm-700 leading-relaxed" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 md:p-6">
      <h2 className="font-display text-[22px] text-navy-950 mb-1">Generate Reports</h2>
      <p className="text-[13.5px] text-warm-500 mb-3">{reportMethod(llm)} for <span className="font-medium text-warm-700">{selectedSchedule.name}</span>.</p>
      <div className="mb-5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-warm-700">
        <label htmlFor={docsId} className="flex items-center gap-1.5">
          <input id={docsId} type="checkbox" checked={useDocs} onChange={e => setUseDocs(e.target.checked)} />
          Use project documents (contract and specification requirements, with citations)
        </label>
        {useDocs && (
          <label htmlFor={unrevId} className="flex items-center gap-1.5">
            <input id={unrevId} type="checkbox" checked={withUnreviewed} onChange={e => setWithUnreviewed(e.target.checked)} />
            Include unreviewed documents
          </label>
        )}
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {REPORT_TYPES.map(rt => (
          <button
            key={rt.id}
            onClick={() => handleGenerate(rt.id)}
            disabled={generating !== null}
            className="bg-warm-100 border border-warm-200 rounded-lg p-5 flex gap-4 items-start text-left hover:border-warm-300 transition-colors disabled:opacity-50"
          >
            <div className="w-9 h-9 bg-navy-900 rounded-md flex items-center justify-center flex-shrink-0">
              {generating === rt.id
                ? <Loader2 size={15} className="text-accent-400 animate-spin" aria-hidden />
                : <rt.icon size={15} className="text-accent-400" aria-hidden />
              }
            </div>
            <div>
              <div className="text-[14px] font-semibold text-navy-950 mb-1">{rt.title}</div>
              <div className="text-[13px] text-warm-500 leading-relaxed">{rt.desc}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
