'use client'

import { useState } from 'react'
import { useApp } from '../layout'
import { BarChart3, Activity, FileText, CheckCircle, Download, X, Loader2, Upload } from 'lucide-react'

const REPORT_TYPES = [
  { id: 'executive_summary', icon: BarChart3,   title: 'Executive Schedule Summary',    desc: 'High-level narrative with status, variance, key findings, and recommendations.' },
  { id: 'critical_path',     icon: Activity,    title: 'Critical & Near-Critical Paths', desc: 'Driving activities, float consumption, path sequences, and near-critical analysis.' },
  { id: 'variance',          icon: FileText,    title: 'Baseline vs Current Variance',   desc: 'Milestone-by-milestone comparison with variance breakdown and cause categories.' },
  { id: 'qa_qc',             icon: CheckCircle, title: 'Schedule QA/QC Audit',           desc: 'DCMA 14-point compliance check with logic issues and specific fixes.' },
]

export default function ReportsPage() {
  const { selectedSchedule } = useApp()
  const [generating, setGenerating] = useState<string | null>(null)
  const [report, setReport] = useState<{ type: string; content: string; scheduleName: string; generatedAt: string } | null>(null)

  const handleGenerate = async (reportType: string) => {
    if (!selectedSchedule) return
    setGenerating(reportType)
    setReport(null)
    try {
      const res  = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportType, scheduleId: selectedSchedule.id }),
      })
      const data = await res.json()
      setReport({
        type: reportType,
        content: data.content || 'Report generation failed.',
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
    const blob = new Blob([report.content], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${report.scheduleName || 'report'}-${report.type}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!selectedSchedule) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-12 h-12 bg-warm-100 border border-warm-200 rounded-lg flex items-center justify-center mb-4">
          <Upload size={20} className="text-warm-400" />
        </div>
        <div className="text-[17px] font-semibold text-navy-950 mb-2">Upload a schedule to generate reports</div>
        <p className="text-[14px] text-warm-500 max-w-[340px]">Professional narrative reports based on your actual schedule data.</p>
      </div>
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
              <Icon size={14} className="text-gold-500" />
            </div>
            <h2 className="font-display text-[20px] text-navy-950">{rt?.title}</h2>
          </div>
          <button onClick={() => setReport(null)} className="text-warm-400 hover:text-warm-600"><X size={18} /></button>
        </div>

        <div className="bg-warm-100 border border-warm-200 rounded-md p-3 mb-4 flex items-center justify-between">
          <div className="text-[12px] text-warm-500">
            {report.scheduleName} · Generated {report.generatedAt ? new Date(report.generatedAt).toLocaleString() : ''}
          </div>
          <button onClick={handleExport} className="flex items-center gap-1.5 text-gold-600 text-[12px] font-medium hover:underline">
            <Download size={13} /> Export
          </button>
        </div>

        <div className="bg-warm-50 border border-warm-200 rounded-lg p-6 md:p-8">
          <div className="text-[14px] text-warm-700 leading-relaxed whitespace-pre-wrap">{report.content}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 md:p-6">
      <h2 className="font-display text-[22px] text-navy-950 mb-1">Generate Reports</h2>
      <p className="text-[13.5px] text-warm-500 mb-5">Select a report type to generate an AI-powered narrative for <span className="font-medium text-warm-700">{selectedSchedule.name}</span>.</p>
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
                ? <Loader2 size={15} className="text-gold-500 animate-spin" />
                : <rt.icon size={15} className="text-gold-500" />
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
