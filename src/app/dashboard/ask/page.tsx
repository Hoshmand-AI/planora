'use client'

import { useState, useEffect, useRef } from 'react'
import { useApp } from '../layout'
import { Send, Upload } from 'lucide-react'

interface Message { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }

const SUGGESTED = [
  'What is the current project status?',
  'Show me the critical path summary',
  'What are the key milestone variances?',
  'Are there any schedule quality issues?',
]

export default function AskPage() {
  const { selectedSchedule } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedSchedule) return
    fetch(`/api/ask?scheduleId=${selectedSchedule.id}`)
      .then(r => r.json())
      .then(data => setMessages(data.messages || []))
  }, [selectedSchedule])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (question?: string) => {
    const q = question || input.trim()
    if (!q || !selectedSchedule) return
    setInput('')

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: q, createdAt: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res  = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, scheduleId: selectedSchedule.id }),
      })
      const data = await res.json()
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: data.answer || 'Unable to generate response.',
        createdAt: new Date().toISOString(),
      }
      setMessages(prev => [...prev, aiMsg])
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'assistant',
        content: 'Network error. Please try again.',
        createdAt: new Date().toISOString(),
      }])
    }
    setLoading(false)
  }

  if (!selectedSchedule) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-12 h-12 bg-warm-100 border border-warm-200 rounded-lg flex items-center justify-center mb-4">
          <Upload size={20} className="text-warm-400" />
        </div>
        <div className="text-[17px] font-semibold text-navy-950 mb-2">Upload a schedule to ask questions</div>
        <p className="text-[14px] text-warm-500 max-w-[340px]">AI-powered Q&A works with your actual schedule data.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100dvh - 104px)' }} /* desktop: 48px header + 40px tab row = 88px; mobile: 48px header + 64px bottom bar = 112px, dvh handles notch */>

      {/* Chat area */}
      <div className="flex-1 overflow-auto p-5 md:p-6">

        {messages.length === 0 && (
          <div className="max-w-[560px] mx-auto">
            <div className="mb-6">
              <h2 className="font-display text-[22px] text-navy-950 mb-1">Ask about your schedule</h2>
              <p className="text-[13.5px] text-warm-500">Ask anything about <span className="font-medium text-warm-700">{selectedSchedule.name}</span> in plain English.</p>
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-warm-400 mb-2">Suggested questions</div>
            <div className="space-y-1.5">
              {SUGGESTED.map(q => (
                <button key={q} onClick={() => handleSend(q)}
                  className="w-full text-left bg-warm-100 border border-warm-200 hover:border-warm-300 rounded-md px-4 py-2.5 text-[13.5px] text-warm-700 transition-colors">
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-4 max-w-[700px] mx-auto">
          {messages.map(msg => (
            <div key={msg.id} className={`${msg.role === 'user' ? 'ml-auto max-w-[75%]' : 'max-w-[85%]'}`}>
              <div className={`rounded-lg px-4 py-3 text-[14px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-navy-900 text-white'
                  : 'bg-warm-100 border border-warm-200 text-warm-700'
              }`}>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
              <div className="text-[10px] text-warm-400 mt-1 px-1">
                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}

          {loading && (
            <div className="max-w-[85%]">
              <div className="bg-warm-100 border border-warm-200 rounded-lg px-4 py-3 text-[13px] text-warm-400">
                Analyzing schedule data…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="bg-warm-50 border-t border-warm-200 px-5 py-3 flex gap-3 items-center">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Ask about your schedule…"
          className="flex-1 bg-warm-100 border border-warm-300 rounded-md px-4 py-2.5 text-[14px] text-warm-700 placeholder:text-warm-400"
          disabled={loading}
        />
        <button
          onClick={() => handleSend()}
          disabled={loading || !input.trim()}
          className="w-9 h-9 bg-gold-500 rounded-md flex items-center justify-center text-navy-950 hover:bg-gold-400 transition-colors disabled:opacity-40"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  )
}
