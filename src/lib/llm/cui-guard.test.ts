import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat, chatJson, deploymentKind, isExternalModel, llmStatus, RestrictedDataError, CUI_CLOUD_WARNING } from './provider'
import { runWithRequest, type RequestInfo } from '@/lib/server/context'
import { classificationFromAnswer, classificationResolver, isRestrictedClassification } from '@/lib/server/classification'

vi.mock('@/lib/db', () => ({ query: vi.fn(async () => { throw new Error('db down') }) }))

const req = (classification: string | null): RequestInfo => ({
  requestId: 't', method: 'POST', path: '/api/plans/p1/suggest', ip: null, userAgent: null,
  dataClassification: async () => classification,
})

describe('CUI / classified data never goes to a cloud model', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('detects the deployment (commercial cloud unless on-prem or air-gapped)', () => {
    expect(deploymentKind({})).toBe('commercial_cloud')
    expect(deploymentKind({ PLANORA_DEPLOYMENT: 'onprem' })).toBe('on_prem')
    expect(deploymentKind({ PLANORA_DEPLOYMENT: 'on-premises' })).toBe('on_prem')
    expect(deploymentKind({ PLANORA_AIRGAPPED: 'true' })).toBe('airgapped')
  })

  it('treats the cloud provider and public model hosts as external, private hosts as internal', () => {
    expect(isExternalModel({ mode: 'cloud', host: 'api.openai.com' })).toBe(true)
    expect(isExternalModel({ mode: 'local', host: 'llm.example.com' }, {})).toBe(true)
    expect(isExternalModel({ mode: 'local', host: '10.0.0.5' }, {})).toBe(false)
    expect(isExternalModel({ mode: 'offline', host: null })).toBe(false)
  })

  it('reads the interview classification (withheld counts as classified)', () => {
    expect(classificationFromAnswer({ status: 'known', value: 'cui' })).toBe('cui')
    expect(classificationFromAnswer({ status: 'withheld' })).toBe('classified')
    expect(classificationFromAnswer({ status: 'known', value: 'unclassified' })).toBe('unclassified')
    expect(classificationFromAnswer(null)).toBeNull()
    expect(isRestrictedClassification('cui') && isRestrictedClassification('classified') && !isRestrictedClassification('unclassified')).toBe(true)
  })

  it('refuses a cloud model call for a CUI or classified project before anything is sent', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-not-used')
    vi.stubEnv('PLANORA_AI_MODE', 'cloud')
    for (const c of ['cui', 'classified']) {
      await expect(runWithRequest(req(c), () => chat([{ role: 'user', content: 'secret project details' }]))).rejects.toBeInstanceOf(RestrictedDataError)
      // Structured calls don't swallow the refusal as a validation retry.
      await expect(runWithRequest(req(c), () => chatJson([{ role: 'user', content: 'x' }], v => v))).rejects.toBeInstanceOf(RestrictedDataError)
    }
  })

  it('refuses a public OpenAI-compatible endpoint too', async () => {
    vi.stubEnv('PLANORA_AI_MODE', 'local')
    vi.stubEnv('LLM_BASE_URL', 'https://llm.example.com/v1')
    await expect(runWithRequest(req('cui'), () => chat([{ role: 'user', content: 'x' }]))).rejects.toBeInstanceOf(RestrictedDataError)
  })

  it('a failed classification lookup is treated as classified (fails closed)', async () => {
    const resolve = classificationResolver(new Request('http://x/api/plans/p1/suggest', { method: 'POST' }), '/api/plans/p1/suggest', 'o1')
    expect(await resolve!()).toBe('classified')
    expect(classificationResolver(new Request('http://x/api/portfolio'), '/api/portfolio', 'o1')).toBeUndefined()
  })

  it('shows the commercial-cloud CUI warning in the AI status', () => {
    vi.stubEnv('PLANORA_AIRGAPPED', '')
    vi.stubEnv('PLANORA_DEPLOYMENT', '')
    expect(llmStatus().cuiWarning).toBe(CUI_CLOUD_WARNING)
    vi.stubEnv('PLANORA_DEPLOYMENT', 'onprem')
    expect(llmStatus().cuiWarning).toBeUndefined()
  })
})
