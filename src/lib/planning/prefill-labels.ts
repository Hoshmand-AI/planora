// Labels and types for interview answers proposed from a document (safe to import in the browser).

export type PrefillQuestion =
  | 'project.type' | 'project.state' | 'project.city' | 'project.scope' | 'project.gross_sqft' | 'project.stories'
  | 'project.target_start' | 'project.required_finish' | 'project.delivery' | 'project.federal' | 'project.value_musd'
  | 'design.drawings' | 'design.percent'

export const PREFILL_QUESTIONS: Record<PrefillQuestion, string> = {
  'project.type': 'Project type', 'project.state': 'State', 'project.city': 'City or county (AHJ)', 'project.scope': 'New construction, addition or renovation',
  'project.gross_sqft': 'Gross building area (sf)', 'project.stories': 'Stories above grade', 'project.target_start': 'Notice to Proceed / start',
  'project.required_finish': 'Required completion', 'project.delivery': 'Delivery method', 'project.federal': 'Federal project',
  'project.value_musd': 'Construction value (USD millions)', 'design.drawings': 'Drawings exist', 'design.percent': 'Design completion (%)',
}

export interface Proposal {
  questionId: PrefillQuestion
  value: string | number | boolean
  /** The value as a person reads it, e.g. "125,000 sf", "Texas" */
  display: string
  /** The sentence it came from (shown to the user; never logged) */
  quote: string
  page: number | null
  method: 'rules' | 'model'
}

