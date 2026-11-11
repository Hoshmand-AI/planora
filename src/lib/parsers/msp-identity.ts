// MS Project task identity across updates.
//
// A task without an activity code of its own is known in RunF9 by its MS Project row number ("A12").
// Row numbers change when rows are inserted, deleted or moved; MS Project's Unique ID never does, and
// the importer stores it as Activity.sourceId. When a new update of a project has renumbered rows, each
// task keeps the ID it had in the previous update (matched by Unique ID), so updates compare task to
// task. Nothing changes when no row was renumbered.

export interface IdentityRef { activityId: string; sourceId?: string | null }

/** An ID the importer made from the row number. */
const ROW_ID = /^A\d+$/

export interface MspAlignment {
  /** Tasks that took their earlier ID because their row number had changed */
  renumbered: number
  /** New tasks whose row number was already another task's ID, and so got a suffixed ID */
  disambiguated: number
  /** Plain sentence for the import notes, or null when nothing changed */
  note: string | null
}

/**
 * Give each row-numbered task of `next` the ID it had in `prev` (same Unique ID). Mutates `next`.
 * Tasks with a code of their own are never touched.
 */
export function alignMspIds(prev: IdentityRef[], next: IdentityRef[]): MspAlignment {
  const none: MspAlignment = { renumbered: 0, disambiguated: 0, note: null }
  const prevByUid = new Map<string, string>()
  for (const p of prev) if (p.sourceId && ROW_ID.test(p.activityId) && !prevByUid.has(p.sourceId)) prevByUid.set(p.sourceId, p.activityId)
  if (!prevByUid.size) return none
  const rowKeyed = next.filter(a => ROW_ID.test(a.activityId))
  const moved = rowKeyed.filter(a => a.sourceId && prevByUid.has(a.sourceId) && prevByUid.get(a.sourceId) !== a.activityId)
  if (!moved.length) return none

  // IDs that stay as they are: tasks with their own code, and row-numbered tasks known from before.
  const taken = new Set<string>(next.filter(a => !ROW_ID.test(a.activityId)).map(a => a.activityId))
  const known = rowKeyed.filter(a => a.sourceId && prevByUid.has(a.sourceId))
  const fresh = rowKeyed.filter(a => !(a.sourceId && prevByUid.has(a.sourceId)))
  // Two tasks can only claim one earlier ID if the previous file repeated a Unique ID; the first keeps it.
  const rest: IdentityRef[] = []
  for (const a of known) {
    const id = prevByUid.get(a.sourceId!)!
    if (taken.has(id)) { rest.push(a); continue }
    a.activityId = id
    taken.add(id)
  }
  // New tasks keep their row number unless a task from before already holds it.
  let disambiguated = 0
  for (const a of [...rest, ...fresh]) {
    if (taken.has(a.activityId)) {
      const base = `${a.activityId}-U${a.sourceId || 'x'}`
      let id = base
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
      a.activityId = id
      disambiguated++
    }
    taken.add(a.activityId)
  }
  const s = (n: number) => (n === 1 ? '' : 's')
  return {
    renumbered: moved.length, disambiguated,
    note: `Rows were renumbered in MS Project since the previous update. ${moved.length} task${s(moved.length)} kept the ID ${moved.length === 1 ? 'it' : 'they'} had before (matched by MS Project's Unique ID), so the updates compare task to task${disambiguated ? `; ${disambiguated} new task${s(disambiguated)} got an ID ending in "-U" and the Unique ID, because the row number was already in use` : ''}. IDs here can differ from the row numbers MS Project shows now.`,
  }
}
