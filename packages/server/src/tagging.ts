import {
  type ActivityTagsResponse,
  applyTagEdits,
  type Filter,
  type NewType,
  type TagRegistry,
  type TagType,
  type TagWrite,
  type TagWriteResponse,
  validateTag,
} from '@tracks/core'
import { sql } from 'drizzle-orm'
import type { Conn, Db } from './db.ts'
import { scopeFor } from './queries.ts'
import { whereFor } from './query.ts'
import { collectTypes, createType, loadRegistry } from './registry.ts'
import { activities } from './schema.ts'

/**
 * The writes.
 *
 * Two of them, and they share everything that matters: the registry is read once, a
 * new type is created inside the same transaction as the tag that needs it, the
 * arrays are rebuilt by the same `applyTagEdits`, and the type GC runs last. What
 * differs is only which activities are addressed — a filter, or an id.
 *
 * Rebuilt in JavaScript rather than with a `json_*` UPDATE: the rules being applied
 * are the single-valued replacement and the sort order, both of which already exist
 * as one function the browser runs too. Two hundred rows is not a reason to write
 * them a second time in SQL.
 */

/** Thrown for anything a caller could have got right; the routes turn it into a 400. */
export class TagWriteError extends Error {}

/**
 * Creates the type a write announces, if it is not already there.
 *
 * Idempotent on purpose: the browser sends `newType` whenever the type it is about to
 * use is absent from the registry it holds, and that registry can be one write out of
 * date — two tabs, or a type an import just created.
 */
function withNewType(db: Conn, registry: Map<string, TagType>, newType: NewType | undefined) {
  if (newType && !registry.has(newType.name)) createType(db, registry, newType)
}

function assertValid(registry: TagRegistry, tags: readonly string[]) {
  for (const tag of tags) {
    const problem = validateTag(registry, tag)
    if (problem) throw new TagWriteError(problem)
  }
}

/**
 * Adds and removes over everything the filter matches.
 *
 * Only rows that actually change are written, so `changed` is the number the result
 * line can state without lying — applying a tag half the set already carries reports
 * the half that gained it.
 */
export function writeTags(db: Db, filter: Filter, write: TagWrite): TagWriteResponse {
  return db.transaction((tx) => {
    const registry = loadRegistry(tx)
    withNewType(tx, registry, write.newType)
    assertValid(registry, [...write.add, ...write.remove])

    const rows = tx.all<{ id: number; tags: string }>(sql`
      SELECT a.id, a.tags FROM activities a WHERE ${whereFor(scopeFor(tx, filter))}`)

    let changed = 0
    for (const row of rows) {
      const before = row.tags
      const after = JSON.stringify(applyTagEdits(registry, JSON.parse(before) as string[], write))
      if (after === before) continue

      tx.run(sql`UPDATE activities SET tags = ${after} WHERE id = ${row.id}`)
      changed++
    }

    collectTypes(tx)
    return { changed }
  })
}

/** One activity's tags, as they should now read. */
export function writeActivityTags(
  db: Db,
  id: number,
  body: { tags: string[]; newType?: NewType },
): ActivityTagsResponse | null {
  return db.transaction((tx) => {
    const registry = loadRegistry(tx)
    withNewType(tx, registry, body.newType)
    assertValid(registry, body.tags)

    // Through the same edit function as a bulk write, from an empty array: the sort,
    // the deduplication and the single-valued rule are stated once.
    const tags = applyTagEdits(registry, [], { add: body.tags })

    const updated = tx
      .update(activities)
      .set({ tags: JSON.stringify(tags) })
      .where(sql`id = ${id}`)
      .run()

    if (updated.changes === 0) return null

    collectTypes(tx)
    return { tags }
  })
}
