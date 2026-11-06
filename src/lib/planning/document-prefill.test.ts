import { describe, expect, it } from 'vitest'
import { checkValue, finalizeModelPrefill, isoFromText, rulesPrefill } from './document-prefill'

const RFP = [
  { page: 1, text: 'REQUEST FOR PROPOSALS. Construction of the Riverside Medical Office Building, City of Austin. The project is located at 1200 Riverside Drive, Austin, TX 78704. The work is new construction of a three-story medical office building of approximately 86,500 gross square feet.' },
  { page: 2, text: 'The project will be delivered by Construction Manager at Risk. The estimated construction cost is $42,000,000. The design is at 95% construction documents; a drawing list is attached. Notice to Proceed is anticipated on March 1, 2027. Substantial Completion shall be achieved no later than June 30, 2028.' },
]

describe('interview answers proposed from a project document', () => {
  it('finds the answers an RFP states, each with its sentence and page', () => {
    const by = Object.fromEntries(rulesPrefill(RFP).map(p => [p.questionId, p]))
    expect(by['project.gross_sqft']).toMatchObject({ value: 86500, page: 1, method: 'rules' })
    expect(by['project.stories'].value).toBe(3)
    expect(by['project.state']).toMatchObject({ value: 'TX', display: 'Texas' })
    expect(by['project.city'].value).toBe('City of Austin')
    expect(by['project.scope'].value).toBe('new_construction')
    expect(by['project.delivery'].value).toBe('cmar')
    expect(by['project.value_musd'].value).toBe(42)
    expect(by['design.percent']).toMatchObject({ value: 95, page: 2 })
    expect(by['design.drawings'].value).toBe(true)
    expect(by['project.target_start']).toMatchObject({ value: '2027-03-01', display: '03/01/2027' })
    expect(by['project.required_finish'].value).toBe('2028-06-30')
    expect(by['project.type']).toMatchObject({ value: 'healthcare' })
    expect(by['project.gross_sqft'].quote).toContain('86,500 gross square feet')
  })

  it('does not invent answers a document does not state', () => {
    const p = rulesPrefill([{ page: null, text: 'The Contractor shall keep the site clean and remove debris daily.' }])
    expect(p).toEqual([])
  })

  it('recognizes a federal client and design-build', () => {
    const by = Object.fromEntries(rulesPrefill([{ page: 4, text: 'This is a U.S. Army Corps of Engineers design-build project for a new warehouse facility.' }]).map(p => [p.questionId, p.value]))
    expect(by['project.federal']).toBe(true)
    expect(by['project.delivery']).toBe('db')
    expect(by['project.type']).toBe('warehouse_industrial')
  })

  it('keeps a model answer only when its quote is in the document and its value is allowed', () => {
    const r = finalizeModelPrefill({ answers: [
      { questionId: 'project.stories', value: 3, quote: 'new construction of a three-story medical office building', page: 1 },
      { questionId: 'project.gross_sqft', value: 99000, quote: 'The building is 99,000 square feet.', page: 1 },
      { questionId: 'project.type', value: 'spaceport', quote: 'Construction of the Riverside Medical Office Building', page: 1 },
      { questionId: 'project.delivery', value: 'cmar', quote: 'delivered by Construction Manager at Risk', page: 2 },
    ] }, RFP, ['project.stories', 'project.gross_sqft', 'project.type'])
    expect(r.proposals.map(p => [p.questionId, p.value, p.page, p.method])).toEqual([['project.stories', 3, 1, 'model']])
    expect(r.dropped).toBe(3)
    expect(() => finalizeModelPrefill({ nope: 1 }, RFP, [])).toThrow(/answers/)
  })

  it('checks values against what each question accepts', () => {
    expect(checkValue('project.state', 'ca')).toEqual({ value: 'CA', display: 'California' })
    expect(checkValue('project.state', 'XX')).toBeNull()
    expect(checkValue('project.target_start', '2027-02-30')).toBeNull()
    expect(checkValue('design.percent', 140)).toBeNull()
    expect(isoFromText('3/1/2027')).toBe('2027-03-01')
    expect(isoFromText('February 30, 2027')).toBeNull()
  })
})
