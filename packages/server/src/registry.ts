import type { TagType } from '@tracks/core'
import { eq, sql } from 'drizzle-orm'
import type { Conn } from './db.ts'
import type { Owner } from './query.ts'
import { tagTypes } from './schema.ts'

/**
 * Reads the tag type registry.
 *
 * Read per call rather than cached: it is a handful of rows on a local SQLite file,
 * and not caching means a hand-edit in a SQLite browser — still the way this database
 * is inspected — takes effect without a restart.
 */
export function loadRegistry(db: Conn, owner: Owner): Map<string, TagType> {
  const rows = db
    .select()
    .from(tagTypes)
    .where(eq(tagTypes.userId, owner.userId))
    .orderBy(tagTypes.sort)
    .all()

  return new Map(
    rows.map((row): [string, TagType] => [
      row.name,
      {
        name: row.name,
        label: row.label,
        singleValued: row.singleValued,
        sort: row.sort,
      },
    ]),
  )
}

/**
 * The types an importer writes, and what they are called.
 *
 * Here rather than in a migration because a type lives only as long as something
 * carries a tag of it: `sport` and `source` are deleted with the last activity that
 * had them, and an import must be able to bring them back. A seeded row would only
 * describe the first database ever created.
 *
 * Everything else is created by hand, with its label typed at the moment the first
 * tag of it is applied.
 */
const SEED_TYPES: Record<string, { label: string; singleValued: boolean }> = {
  sport: { label: 'Sport', singleValued: true },
  source: { label: 'Source', singleValued: true },
}

export function seedFor(name: string): { label: string; singleValued: boolean } | undefined {
  return SEED_TYPES[name]
}

/**
 * Registers a type, appended to the end of the sidebar.
 *
 * Callers hold the registry they read at the start of a request, so the new type is
 * spliced into that map as well as the table — otherwise a second tag of the same new
 * type in the same run would try to create it again and hit the primary key.
 */
export function createType(
  db: Conn,
  owner: Owner,
  registry: Map<string, TagType>,
  type: { name: string; label: string; singleValued: boolean },
): TagType {
  const { max } = db.get<{ max: number | null }>(
    sql`SELECT max(sort) AS max FROM tag_types WHERE user_id = ${owner.userId}`,
  ) ?? { max: null }
  const row: TagType = { ...type, sort: (max ?? 0) + 1 }

  db.insert(tagTypes)
    .values({ ...row, userId: owner.userId })
    .run()
  registry.set(row.name, row)

  return row
}

/**
 * Deletes every type no activity carries a tag of.
 *
 * This is the whole of type deletion: no control, no cascade dialog, no confirmation,
 * because a type is not a thing you administer — it is the shape of what the data
 * already says. Emptying its last value removes it, whether that was a bulk untag, an
 * edit on one activity, or a re-tag onto a different type.
 *
 * Runs inside the caller's transaction, after every write that touches tags.
 */
export function collectTypes(db: Conn, owner: Owner): void {
  // Both halves are scoped: a type of one person's dies when *their* last tag of it
  // does, and somebody else still using the name keeps only their own alive.
  db.run(sql`
    DELETE FROM tag_types WHERE user_id = ${owner.userId} AND NOT EXISTS (
      SELECT 1 FROM activities, json_each(activities.tags) AS t
      WHERE activities.user_id = ${owner.userId}
        AND substr(t.value, 1, length(tag_types.name) + 1) = tag_types.name || ':')`)
}
