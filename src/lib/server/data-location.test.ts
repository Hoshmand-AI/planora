import { describe, expect, it } from 'vitest'
import { dataLocation } from './data-location'

describe('dataLocation', () => {
  it('describes RunF9 Cloud by default', () => {
    const d = dataLocation({})
    expect(d.hostedBy).toBe('runf9')
    expect(d.label).toBe('RunF9 Cloud · United States')
    expect(d.documentSearch).toMatch(/inside this deployment’s database/)
    expect(d.documentSearch).not.toMatch(/meaning-based/)
  })

  it('describes a customer deployment and uses its own label', () => {
    const d = dataLocation({ RUNF9_DEPLOYMENT: 'on-prem', RUNF9_DATA_LOCATION: 'Your Azure subscription · East US' })
    expect(d.hostedBy).toBe('customer')
    expect(d.label).toBe('Your Azure subscription · East US')
    expect(d.database).toMatch(/Your PostgreSQL/)
  })

  it('says meaning-based search runs in-network when an embedding model is configured', () => {
    const d = dataLocation({ RUNF9_AIRGAPPED: 'true', RUNF9_EMBEDDINGS_MODEL: 'nomic-embed-text', RUNF9_EMBEDDINGS_URL: 'http://embed.internal:11434/v1' })
    expect(d.label).toBe('Your servers (air-gapped)')
    expect(d.documentSearch).toMatch(/meaning-based/)
  })
})
