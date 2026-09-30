import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { llmStatus } from '@/lib/llm/provider'

/** Where AI calls go (cloud / on-prem / offline) and whether the deployment is air-gapped. */
export async function GET() {
  const ctx = await getAuthContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ llm: llmStatus() })
}
