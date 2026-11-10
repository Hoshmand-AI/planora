'use client'

// Opens the sample hyperscale data center: uploads the sample P6 file (dated around today), adds its
// meeting minutes, email and field report, and its risks and change items, then opens today's brief.
// Everything goes through the same routes a real project uses.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Server } from 'lucide-react'
import { dataCenterSample } from '@/lib/planning/sample-datacenter'
import { postJson } from '@/components/ui'
import { useApp } from '@/app/dashboard/layout'

export function DataCenterSampleButton({ className = '' }: { className?: string }) {
  const { can, refreshSchedules, setSelectedSchedule } = useApp()
  const router = useRouter()
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  if (!can('schedule.write')) return null

  const open = async () => {
    setErr(''); setBusy('Reading the schedule…')
    try {
      const d = new Date()
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const s = dataCenterSample(today)
      const fd = new FormData()
      fd.set('file', new File([s.xer], s.fileName, { type: 'application/octet-stream' }))
      fd.set('projectType', 'data_center')
      const up = await fetch('/api/schedules', { method: 'POST', body: fd })
      const data = await up.json().catch(() => ({}))
      const id: string | undefined = data.schedule?.id
      if (!up.ok || !id) { setErr(data.error || 'The sample could not be opened.'); setBusy(''); return }
      const base = `/api/schedules/${encodeURIComponent(id)}`
      setBusy('Adding minutes, emails and the register…')
      // The extras are best effort: the schedule alone already gives a full brief.
      for (const doc of s.documents) {
        const f = new FormData()
        f.set('file', new File([doc.text], `${doc.title.replace(/[^\w .-]+/g, ' ')}.txt`, { type: 'text/plain' }))
        f.set('title', doc.title); f.set('docType', doc.docType)
        await fetch(`${base}/documents`, { method: 'POST', body: f }).catch(() => null)
      }
      for (const r of s.register) {
        const due = new Date(d); due.setDate(due.getDate() + r.dueInDays)
        await postJson(`${base}/register`, { kind: r.kind, title: r.title, owner: r.owner, impactDays: r.impactDays, activityCodes: r.activityCodes, dueDate: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}` })
      }
      await refreshSchedules().catch(() => {})
      setSelectedSchedule(data.schedule)
      router.push(`/dashboard/today?schedule=${encodeURIComponent(id)}`)
    } catch { setErr('Network error. Check your connection and try again.') }
    setBusy('')
  }

  return (
    <div className={className}>
      <button type="button" onClick={open} disabled={!!busy} className="pressable inline-flex items-center gap-2 rounded-full border border-warm-300 bg-white px-4 py-2 text-[13.5px] font-semibold text-navy-950 hover:bg-warm-100 disabled:opacity-70">
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Server size={14} aria-hidden />}
        {busy || 'Open the sample data center (60 MW)'}
      </button>
      {err && <p role="alert" className="mt-2 text-[13px] text-status-at-risk">{err}</p>}
    </div>
  )
}
