import type { TagRegistry, TagType } from '@tracks/core'
import { eq } from 'drizzle-orm'
import type { Db } from './db.ts'
import { tagTypes } from './schema.ts'

/**
 * Reads the tag type registry.
 *
 * Read per call rather than cached: it is a handful of rows on a local SQLite file,
 * and not caching means a hand-edit in a SQLite browser — which is how this database
 * is inspected until the UI exists — takes effect without a restart.
 */
export function loadRegistry(db: Db): TagRegistry {
  const rows = db.select().from(tagTypes).orderBy(tagTypes.sort).all()

  return new Map(
    rows.map((row): [string, TagType] => [
      row.name,
      {
        name: row.name,
        label: row.label,
        enumValues: row.enumValues === null ? null : (JSON.parse(row.enumValues) as string[]),
        singleValued: row.singleValued,
        color: row.color,
        sort: row.sort,
      },
    ]),
  )
}

/**
 * Adds a value to an enum type, keeping the stored order.
 *
 * A source's vocabulary is a fact and the registry is a preference, so an importer
 * that derives a value the enum no longer contains puts it back rather than dropping
 * the tag. Deleting `run` therefore only sticks until you go for a run.
 *
 * Updates the passed type in place as well as the row, so a caller holding a
 * registry for the length of an import does not re-add the same value 70 times.
 */
export function addEnumValue(db: Db, type: TagType, value: string): void {
  if (!type.enumValues || type.enumValues.includes(value)) return
  type.enumValues.push(value)

  db.update(tagTypes)
    .set({ enumValues: JSON.stringify(type.enumValues) })
    .where(eq(tagTypes.name, type.name))
    .run()
}
