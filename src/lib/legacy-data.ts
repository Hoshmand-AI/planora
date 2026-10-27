// Data saved before the RunF9 rename used a few "planora" names as keys and values: schedule
// analyses (recalculation samples: planoraStart, planoraFloat, ...), saved standards runs and
// organization settings (the framework id PLANORA_COMPOSITE, the threshold source planora_default).
// Stored rows are never rewritten; they are translated to the current names whenever they are read.

const RENAMES: [string, string][] = [
  ['planoraLateStart', 'runf9LateStart'],
  ['planoraLateFinish', 'runf9LateFinish'],
  ['planoraStart', 'runf9Start'],
  ['planoraFinish', 'runf9Finish'],
  ['planoraFloat', 'runf9Float'],
  ['PLANORA_COMPOSITE', 'RUNF9_COMPOSITE'],
  ['planora_default', 'runf9_default'],
]

/** A framework id or threshold source in its current name (legacy names mapped, others unchanged). */
export function currentName(v: string): string {
  return RENAMES.find(([old]) => old === v)?.[1] ?? v
}

/** Deep copy of stored JSON with every legacy key or string value renamed. */
export function upgradeLegacyData<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(v => upgradeLegacyData(v)) as T
  if (typeof value === 'string') return currentName(value) as T
  if (typeof value !== 'object' || value instanceof Date) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [currentName(k), upgradeLegacyData(v)])) as T
}
