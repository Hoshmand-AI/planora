import { describe, expect, it } from 'vitest'
import { extractJson, isAllowedAirgapHost, resolveLlmConfig, DEFAULT_CLOUD_MODEL } from './provider'

describe('LLM provider routing', () => {
  it('defaults to cloud with a key, offline without', () => {
    expect(resolveLlmConfig({ OPENAI_API_KEY: 'sk-x' }).mode).toBe('cloud')
    expect(resolveLlmConfig({}).mode).toBe('offline')
  })

  it('refuses cloud AI in air-gapped mode', () => {
    const c = resolveLlmConfig({ PLANORA_AIRGAPPED: 'true', PLANORA_AI_MODE: 'cloud', OPENAI_API_KEY: 'sk-x' })
    expect(c.mode).toBe('offline')
    expect(c.error).toMatch(/air-gapped/)
  })

  it('refuses a public model host in air-gapped mode', () => {
    const c = resolveLlmConfig({ PLANORA_AIRGAPPED: '1', LLM_BASE_URL: 'https://api.example.com/v1' })
    expect(c.mode).toBe('offline')
    expect(c.error).toMatch(/not a private/)
  })

  it('allows on-prem hosts and flags small models', () => {
    const c = resolveLlmConfig({ PLANORA_AIRGAPPED: 'true', LLM_BASE_URL: 'http://10.20.0.5:11434/v1', LLM_MODEL: 'llama3.1:8b' })
    expect(c.mode).toBe('local')
    expect(c.smallModel).toBe(true)
    expect(resolveLlmConfig({ PLANORA_AIRGAPPED: 'true', LLM_BASE_URL: 'http://gpu01.scif.internal:8000/v1', LLM_MODEL: 'llama-3.3-70b', PLANORA_APPROVED_MODELS: 'llama-3.3-70b' }).smallModel).toBe(false)
    expect(resolveLlmConfig({ PLANORA_AIRGAPPED: 'true', LLM_BASE_URL: 'http://llm.corp/v1', PLANORA_ALLOWED_HOSTS: 'llm.corp' }).mode).toBe('local')
  })

  it('only uses models in the approved registry, pinned by default', () => {
    expect(resolveLlmConfig({ OPENAI_API_KEY: 'k' }).model).toBe(DEFAULT_CLOUD_MODEL)
    const refused = resolveLlmConfig({ OPENAI_API_KEY: 'k', LLM_MODEL: 'some-unreviewed-model' })
    expect(refused.mode).toBe('offline')
    expect(refused.error).toMatch(/approved model registry/)
    expect(resolveLlmConfig({ OPENAI_API_KEY: 'k', LLM_MODEL: 'gpt-4o-mini', PLANORA_APPROVED_MODELS: 'gpt-4o-mini' }).mode).toBe('cloud')
    expect(resolveLlmConfig({ LLM_BASE_URL: 'http://localhost:11434/v1', LLM_MODEL: 'llama3.1:8b', PLANORA_APPROVED_MODELS: 'qwen2.5:14b' }).mode).toBe('offline')
  })

  it('classifies hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.9', '172.16.0.1', 'gpu.local', 'x.internal']) expect(isAllowedAirgapHost(h)).toBe(true)
    for (const h of ['api.openai.com', '8.8.8.8', '172.32.0.1', 'example.com']) expect(isAllowedAirgapHost(h)).toBe(false)
  })

  it('extracts JSON from chatty small-model replies', () => {
    expect(extractJson('Sure! ```json\n[{"a":1}]\n``` hope that helps')).toEqual([{ a: 1 }])
    expect(extractJson('Here: {"q":"x {y}","n":[1,2]} done')).toEqual({ q: 'x {y}', n: [1, 2] })
    expect(() => extractJson('no json here')).toThrow()
  })
})
