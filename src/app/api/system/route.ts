import { NextResponse } from 'next/server'
import { api } from '@/lib/server/api'
import { llmStatus } from '@/lib/llm/provider'

/** Where AI calls go (cloud / on-prem / offline) and whether the deployment is air-gapped. */
export const GET = api({ permission: 'read' }, async (_req, { auth: ctx }) => {
  return NextResponse.json({ llm: llmStatus() })
})
