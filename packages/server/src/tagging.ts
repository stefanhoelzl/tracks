import {
  type ActivityTagsResponse,
  applyTagEdits,
  type NewType,
  type TagRegistry,
  type TagType,
  type TagWrite,
  type TagWriteResponse,
  validateTag,
} from '@tracks/core'
import { sql } from 'drizzle-orm'
import type { Conn, Db } from './connect.ts'
import type { Owner, Scope } from './query.ts'
import { whereFor } from './query.ts'
import { collectTypes, createType, loadRegistry } from './registry.ts'
import { activities } from './schema.ts'

/**
 * The writes.
 *
 * Two of them, and they share everything that matters: the registry is read once, a
 * new type is created inside the same transaction as the tag that needs it, the
 * arrays are rebuilt by the same `applyTagEdits`, and the type GC runs last. What
 * differs is only which activities are addressed — a filter, or an id — and both are
 * addressed within one owner, which neither of them may widen.
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
async function withNewType(
  db: Conn,
  owner: Owner,
  registry: Map<string, TagType>,
  newType: NewType | undefined,
) {
  if (newType && !registry.has(newType.name)) await createType(db, owner, registry, newType)
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
export function writeTags(db: Db, scope: Scope, write: TagWrite): Promise<TagWriteResponse> {
  return db.transaction(async (tx) => {
    const registry = await loadRegistry(tx, scope)
    await withNewType(tx, scope, registry, write.newType)
    assertValid(registry, [...write.add, ...write.remove])

    const rows = await tx.all<{ id: number; tags: string }>(sql`
      SELECT a.id, a.tags FROM activities a WHERE ${whereFor(scope)}`)

    let changed = 0
    for (const row of rows) {
      const before = row.tags
      const after = JSON.stringify(applyTagEdits(registry, JSON.parse(before) as string[], write))
      if (after === before) continue

      await tx.run(sql`UPDATE activities SET tags = ${after} WHERE id = ${row.id}`)
      changed++
    }

    await collectTypes(tx, scope)
    return { changed }
  })
}

/** One activity's tags, as they should now read. */
export function writeActivityTags(
  db: Db,
  owner: Owner,
  id: number,
  body: { tags: string[]; newType?: NewType },
): Promise<ActivityTagsResponse | null> {
  return db.transaction(async (tx) => {
    const registry = await loadRegistry(tx, owner)
    await withNewType(tx, owner, registry, body.newType)
    assertValid(registry, body.tags)

    // Through the same edit function as a bulk write, from an empty array: the sort,
    // the deduplication and the single-valued rule are stated once.
    const tags = applyTagEdits(registry, [], { add: body.tags })

    // Someone else's id changes nothing and reports the same nothing an absent one
    // does, which is what the route needs to answer both with one 404.
    const updated = await tx
      .update(activities)
      .set({ tags: JSON.stringify(tags) })
      .where(sql`id = ${id} AND user_id = ${owner.userId}`)
      .run()

    if (updated.rowsAffected === 0) return null

    await collectTypes(tx, owner)
    return { tags }
  })
}
