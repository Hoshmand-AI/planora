'use client'

// Organization → Workspaces: matter / engagement workspaces with ethical walls. Owners and admins
// create workspaces, choose who is in each, limit members to their workspaces and move schedules and
// plans between workspaces. Enforcement is on the server (src/lib/server/workspaces.ts); this screen
// only manages the settings. Every change is recorded in the audit log.

import { useCallback, useEffect, useState } from 'react'
import { Section, Field, Button, Alert, inputClass, postJson } from '@/components/ui'

interface Member { id: string; name: string; email: string; role: string }
interface Workspace { id: string; name: string; walled: boolean; memberIds: string[]; scheduleCount: number; planCount: number }
interface Item { id: string; name: string; version?: string; workspaceId: string | null }
interface Data { workspaces: Workspace[]; restrictedMemberIds: string[]; items: { schedules: Item[]; plans: Item[] } }

const URL_ = '/api/workspaces'
const SEES_ALL = ['owner', 'admin']

export function Workspaces({ members }: { members: Member[] }) {
  const [data, setData] = useState<Data | null>(null)
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', walled: true })
  const [adding, setAdding] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const res = await fetch(URL_)
    if (res.ok) setData(await res.json())
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (id: string, payload: Record<string, unknown>, ok?: string) => {
    setBusy(id); setMsg(null)
    const r = await postJson(URL_, payload)
    setBusy(null)
    if (!r.ok) { setMsg({ tone: 'error', text: String(r.data.error || 'Something went wrong.') }); return null }
    if (ok) setMsg({ tone: 'success', text: ok })
    await load()
    return r.data
  }

  if (!data) return null
  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? 'Former member'
  const restricted = new Set(data.restrictedMemberIds)
  const selectClass = 'bg-warm-100 border border-warm-300 rounded px-2 py-1 text-[13px] text-warm-700'

  return (
    <Section title="Workspaces (ethical walls)" description="Group schedules and plans by client matter or engagement. A walled workspace is visible only to its members; a member limited to their workspaces sees nothing else. Owners and admins always see everything. Changes take effect on the member's next request and are recorded in the audit log.">
      {msg && <div className="mb-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <form className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end mb-4" onSubmit={async e => {
        e.preventDefault()
        if (await act('create', { action: 'create', ...draft }, `Workspace "${draft.name.trim()}" created.`)) setDraft({ name: '', walled: true })
      }}>
        <Field label="New workspace name" hint="For example the client or matter number.">{p => <input {...p} required maxLength={120} className={inputClass} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />}</Field>
        <label className="flex items-center gap-2 text-[13px] text-warm-700 pb-2"><input type="checkbox" className="w-4 h-4 accent-accent-500" checked={draft.walled} onChange={e => setDraft({ ...draft, walled: e.target.checked })} />Walled</label>
        <Button type="submit" disabled={busy === 'create'}>Create workspace</Button>
      </form>

      {!data.workspaces.length && <p className="text-[13px] text-warm-600 mb-4">No workspaces yet. Until you create one, every member sees every schedule and plan their role allows.</p>}

      <ul className="space-y-3 mb-5">
        {data.workspaces.map(w => (
          <li key={w.id} className="border border-warm-200 rounded-md p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium text-navy-950 text-[14px]">{w.name}</span>
                <span className="text-[12px] text-warm-600"> · {w.walled ? 'Walled: members only' : 'Open to the organization'} · {w.scheduleCount} schedule(s), {w.planCount} plan(s)</span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" disabled={busy === w.id} onClick={() => act(w.id, { action: 'update', workspaceId: w.id, walled: !w.walled }, w.walled ? `${w.name} is now open to the organization.` : `${w.name} is now walled.`)}>{w.walled ? 'Open' : 'Wall off'}</Button>
                <Button variant="ghost" className="text-status-at-risk" disabled={busy === w.id} onClick={async () => {
                  if (!confirm(`Delete the workspace "${w.name}"? It must be empty.`)) return
                  await act(w.id, { action: 'delete', workspaceId: w.id }, `${w.name} deleted.`)
                }}>Delete</Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 items-center">
              {w.memberIds.length ? w.memberIds.map(id => (
                <span key={id} className="inline-flex items-center gap-1 bg-warm-100 border border-warm-200 rounded px-2 py-0.5 text-[12px] text-warm-700">
                  {nameOf(id)}
                  <button type="button" className="text-warm-600 hover:text-status-at-risk" aria-label={`Remove ${nameOf(id)} from ${w.name}`} onClick={() => act(w.id, { action: 'remove_member', workspaceId: w.id, userId: id })}>×</button>
                </span>
              )) : <span className="text-[12px] text-warm-600">No members yet.</span>}
              <select aria-label={`Add a member to ${w.name}`} className={selectClass} value={adding[w.id] ?? ''} onChange={async e => {
                const userId = e.target.value
                setAdding({ ...adding, [w.id]: '' })
                if (userId) await act(w.id, { action: 'add_member', workspaceId: w.id, userId })
              }}>
                <option value="">Add member…</option>
                {members.filter(m => !w.memberIds.includes(m.id)).map(m => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
              </select>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="text-[13.5px] font-medium text-navy-950 mb-1">Limit members to their workspaces</h3>
      <p className="text-[12.5px] text-warm-600 mb-2">A limited member sees only the schedules and plans in workspaces they belong to, including on exports, reports, comparisons, the portfolio and firm history.</p>
      <ul className="divide-y divide-warm-200 border border-warm-200 rounded-md mb-5">
        {members.map(m => (
          <li key={m.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
            <span><span className="text-navy-950 font-medium">{m.name}</span> <span className="text-warm-600">· <span className="capitalize">{m.role}</span></span></span>
            {SEES_ALL.includes(m.role)
              ? <span className="text-[12px] text-warm-600">Sees every workspace</span>
              : <label className="flex items-center gap-2 text-warm-700"><input type="checkbox" className="w-4 h-4 accent-accent-500" checked={restricted.has(m.id)} disabled={busy === `r:${m.id}`}
                  onChange={e => act(`r:${m.id}`, { action: 'set_restricted', userId: m.id, restricted: e.target.checked }, e.target.checked ? `${m.name} now sees only their workspaces.` : `${m.name} is no longer limited.`)} />Limited</label>}
          </li>
        ))}
      </ul>

      {!!data.workspaces.length && (
        <>
          <h3 className="text-[13.5px] font-medium text-navy-950 mb-1">Schedules and plans</h3>
          <p className="text-[12.5px] text-warm-600 mb-2">Moving an uploaded schedule moves every update of that project; moving a plan moves the schedules published from it.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="sr-only">Workspace of each schedule and plan</caption>
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-warm-500 border-b border-warm-200">
                <th scope="col" className="py-2 pr-3 font-semibold">Item</th><th scope="col" className="py-2 font-semibold">Workspace</th>
              </tr></thead>
              <tbody>
                {([['schedule', data.items.schedules], ['plan', data.items.plans]] as const).flatMap(([type, items]) => items.map(it => (
                  <tr key={`${type}:${it.id}`} className="border-b border-warm-100">
                    <td className="py-2 pr-3 text-navy-950">{it.name}<span className="text-warm-600 text-[12px]"> · {type === 'schedule' ? 'Uploaded schedule' : 'Plan'}</span></td>
                    <td className="py-2">
                      <select aria-label={`Workspace for ${it.name}`} className={selectClass} value={it.workspaceId ?? ''} disabled={busy === `a:${it.id}`}
                        onChange={e => act(`a:${it.id}`, { action: 'assign', itemType: type, itemId: it.id, workspaceId: e.target.value || null }, `${it.name} moved.`)}>
                        <option value="">Organization-wide</option>
                        {data.workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  )
}
