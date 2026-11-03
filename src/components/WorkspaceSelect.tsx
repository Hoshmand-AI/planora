'use client'

// Workspace picker for new plans and uploads (form field "workspaceId"). Shows only the workspaces
// the member can see; renders nothing when the organization has none. Members limited to their
// workspaces don't get the organization-wide option.

import { useEffect, useState } from 'react'

interface Ws { id: string; name: string; walled: boolean }

export function WorkspaceSelect({ className = '', labelClassName = '' }: { className?: string; labelClassName?: string }) {
  const [data, setData] = useState<{ workspaces: Ws[]; restricted: boolean } | null>(null)
  useEffect(() => {
    fetch('/api/workspaces').then(r => (r.ok ? r.json() : null)).then(d => d && setData({ workspaces: d.workspaces || [], restricted: !!d.you?.restricted })).catch(() => {})
  }, [])
  if (!data || !data.workspaces.length) return null
  return (
    <label className="block">
      <span className={labelClassName || 'block text-[11px] font-semibold uppercase tracking-wider text-warm-600 mb-1.5'}>Workspace</span>
      <select name="workspaceId" defaultValue={data.restricted ? data.workspaces[0].id : ''} className={className || 'w-full bg-warm-100 border border-warm-300 rounded-md px-2 py-2 text-[13px] text-warm-700'}>
        {!data.restricted && <option value="">Organization-wide</option>}
        {data.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}{w.walled ? ' (walled)' : ''}</option>)}
      </select>
    </label>
  )
}
