// Construction and contract vocabulary for document search. A question that says "LDs" should find
// a clause about "liquidated damages", and "NTP" the "Notice to Proceed". Expansion is a fixed list
// applied inside RunF9: no model and no network call, so it works in every deployment (including
// air-gapped) and nothing about the query leaves the server.

/** Each group lists terms that mean the same thing in schedules and contracts. Multi-word entries are phrases. */
export const TERM_GROUPS: string[][] = [
  ['ld', 'lds', 'liquidated damages', 'delay damages'],
  ['ntp', 'notice to proceed'],
  ['sc', 'substantial completion'],
  ['fc', 'final completion'],
  ['cpm', 'critical path method', 'critical path'],
  ['tia', 'time impact analysis', 'fragnet'],
  ['eot', 'extension of time', 'time extension'],
  ['co', 'change order', 'change orders'],
  ['cor', 'change order request'],
  ['rfi', 'request for information'],
  ['gmp', 'guaranteed maximum price'],
  ['gc', 'general contractor', 'prime contractor'],
  ['cm', 'construction manager'],
  ['owner', 'employer', 'client'],
  ['float', 'slack', 'total float'],
  ['baseline', 'as-planned', 'baseline schedule'],
  ['update', 'progress update', 'schedule update'],
  ['milestone', 'key date', 'contract milestone'],
  ['duration', 'working days', 'calendar days'],
  ['submittal', 'submittals', 'shop drawings'],
  ['punch list', 'punchlist', 'snag list'],
  ['retainage', 'retention'],
  ['weather', 'inclement weather', 'adverse weather'],
  ['p6', 'primavera'],
  ['wbs', 'work breakdown structure'],
  ['loe', 'level of effort'],
  ['dcma', 'dcma 14 point'],
]

const norm = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

const INDEX: Map<string, string[][]> = (() => {
  const m = new Map<string, string[][]>()
  for (const g of TERM_GROUPS) {
    const terms = [...new Set(g.map(norm).filter(Boolean))]
    for (const t of terms) m.set(t, [...(m.get(t) ?? []), terms])
  }
  return m
})()

/**
 * The extra terms a query should also match: synonyms of every word, and of every two- and
 * three-word phrase, found in the query. Returns only terms not already in the query.
 */
export function expansionsFor(query: string): string[] {
  const words = norm(query).split(' ').filter(Boolean)
  const found = new Set<string>()
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      for (const group of INDEX.get(words.slice(i, i + n).join(' ')) ?? []) for (const t of group) found.add(t)
    }
  }
  const have = new Set(words)
  return [...found].filter(t => !(t.includes(' ') ? norm(query).includes(t) : have.has(t))).slice(0, 24)
}

/** One tsquery operand per term: a single lexeme, or a phrase joined with <-> (followed by). */
export function tsTerm(term: string): string | null {
  const words = norm(term).split(' ').filter(w => /^[\p{L}\p{N}]+$/u.test(w))
  if (!words.length) return null
  return words.length === 1 ? words[0] : `(${words.join(' <-> ')})`
}
