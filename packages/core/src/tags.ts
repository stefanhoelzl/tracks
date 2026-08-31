/**
 * Tag grammar.
 *
 * Every tag is `<type>:<value>` — `sport:hike`, `trip:Balkan 2026`. The type is an
 * identifier; the value is whatever you typed, stored verbatim so nothing has to
 * un-mangle it for display. Splitting on the FIRST colon is what makes a value
 * containing one harmless.
 *
 * The prefix is what removed the old reserved-word rule: the importer owns `sport:`
 * and `source:`, you own everything else, and no name is forbidden anywhere.
 */

import { z } from 'zod'

export interface Tag {
  type: string
  value: string
}

/**
 * One entry of the `tag_types` registry, parsed. A schema rather than an interface
 * because the browser receives these over the wire and validates what it renders
 * against the same definition the server validates what it stores.
 *
 * Four fields, and none of them is a vocabulary. A type used to declare which values
 * it permitted; now its values are simply the ones in use, so the registry holds what
 * a value cannot carry for itself — how to say it, whether an activity may hold more
 * than one, and where it sits in the sidebar.
 */
export const tagTypeSchema = z.object({
  name: z.string(),
  label: z.string(),
  singleValued: z.boolean(),
  sort: z.number().int(),
})

export type TagType = z.infer<typeof tagTypeSchema>

/** The registry, by type name. Read per request — see `loadRegistry`. */
export type TagRegistry = ReadonlyMap<string, TagType>

/** Types are identifiers so they can be a query key and a JSON prefix unambiguously. */
const TYPE_PATTERN = /^[a-z][a-z0-9_]*$/

/**
 * A type as it arrives from the browser, to be created in the same transaction as its
 * first tag — a type created empty would be collected before it was used.
 */
export const newTypeSchema = z.object({
  name: z.string().regex(TYPE_PATTERN, 'a type name is lowercase letters, digits and _'),
  label: z.string().min(1, 'a type needs a label'),
  singleValued: z.boolean(),
})

export type NewType = z.infer<typeof newTypeSchema>

export function formatTag(tag: Tag): string {
  return `${tag.type}:${tag.value}`
}

/** Null when the string is not a tag at all. Split is on the first colon. */
export function parseTag(raw: string): Tag | null {
  const at = raw.indexOf(':')
  if (at <= 0) return null

  const type = raw.slice(0, at)
  const value = raw.slice(at + 1)
  if (!TYPE_PATTERN.test(type) || value === '') return null

  return { type, value }
}

/**
 * Null when valid, otherwise why not — the same message the API and the UI show.
 *
 * The only thing a tag can now be wrong about is its grammar and its type. Values are
 * never refused: there is no declared vocabulary to be outside of, and what stops
 * `balkan 2026` becoming a second trip is the autocomplete, not a rule.
 */
export function validateTag(registry: TagRegistry, raw: string): string | null {
  const tag = parseTag(raw)
  if (!tag) return `'${raw}' is not a <type>:<value> tag`
  if (!registry.has(tag.type)) return `no tag type '${tag.type}'`

  return null
}

/**
 * Stored order. Sorting on write means a re-import that changes nothing produces a
 * byte-identical row, which is what makes "unchanged" honest.
 */
export function sortTags(tags: Iterable<string>): string[] {
  return [...new Set(tags)].sort()
}

/**
 * Applying an edit to one activity's tags.
 *
 * Removals happen first, so an edit that removes and adds the same value is an add —
 * the order the words are in. An add of a single-valued type drops that type's other
 * values silently: replacement is what single-valued *means*, so reporting it as an
 * event would be reporting the rule.
 */
export function applyTagEdits(
  registry: TagRegistry,
  existing: Iterable<string>,
  edits: { add?: readonly string[]; remove?: readonly string[] },
): string[] {
  const tags = new Set(existing)

  for (const tag of edits.remove ?? []) tags.delete(tag)

  for (const raw of edits.add ?? []) {
    const tag = parseTag(raw)
    if (!tag) continue

    if (registry.get(tag.type)?.singleValued) {
      for (const held of tags) {
        if (parseTag(held)?.type === tag.type) tags.delete(held)
      }
    }
    tags.add(raw)
  }

  return sortTags(tags)
}

/**
 * The one merge rule: for each type the source derived a value for, drop that
 * type's existing tags and add the derived one.
 *
 * A type the source says nothing about is untouched — which is what keeps a
 * hand-tagged Garmin upload, whose file carries no `<type>`, hand-tagged forever.
 */
export function mergeDerivedTags(existing: Iterable<string>, derived: Iterable<string>): string[] {
  const derivedTags = [...derived]
  const owned = new Set(derivedTags.map((t) => parseTag(t)?.type))

  const kept = [...existing].filter((t) => !owned.has(parseTag(t)?.type))
  return sortTags([...kept, ...derivedTags])
}

/**
 * One term of a tag filter. `value: null` means *absence* — "no tag of this type" —
 * which an empty value can express unambiguously because the grammar forbids one
 * everywhere else.
 */
export interface TagTerm {
  type: string
  value: string | null
  negated: boolean
}

export function formatTagTerm(term: TagTerm): string {
  return `${term.negated ? '-' : ''}${term.type}:${term.value ?? ''}`
}

/** Null when the term is malformed. `-sport:` reads as "has some sport". */
export function parseTagTerm(raw: string): TagTerm | null {
  const negated = raw.startsWith('-')
  const body = negated ? raw.slice(1) : raw

  const at = body.indexOf(':')
  if (at <= 0) return null

  const type = body.slice(0, at)
  if (!TYPE_PATTERN.test(type)) return null

  const value = body.slice(at + 1)
  return { type, value: value === '' ? null : value, negated }
}
