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

export interface Tag {
  type: string
  value: string
}

/** One entry of the `tag_types` registry, parsed. */
export interface TagType {
  name: string
  label: string
  /** Allowed values, or null when any non-empty string is one. */
  enumValues: string[] | null
  singleValued: boolean
  color: string
  sort: number
}

/** The registry, by type name. Read per request — see `loadRegistry`. */
export type TagRegistry = ReadonlyMap<string, TagType>

/** Types are identifiers so they can be a query key and a JSON prefix unambiguously. */
const TYPE_PATTERN = /^[a-z][a-z0-9_]*$/

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

/** Null when valid, otherwise why not — the same message the API and the UI show. */
export function validateTag(registry: TagRegistry, raw: string): string | null {
  const tag = parseTag(raw)
  if (!tag) return `'${raw}' is not a <type>:<value> tag`

  const type = registry.get(tag.type)
  if (!type) return `no tag type '${tag.type}'`

  if (type.enumValues && !type.enumValues.includes(tag.value)) {
    return `'${tag.value}' is not a value of '${tag.type}'`
  }
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
