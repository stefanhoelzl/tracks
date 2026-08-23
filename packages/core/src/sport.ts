/**
 * Canonical sport vocabulary. These names are RESERVED: they are written
 * automatically from the source's own sport string, so the UI must refuse a
 * manual tag using one of them.
 */
export const SPORTS = [
  'ride',
  'mtb',
  'gravel',
  'run',
  'trailrun',
  'hike',
  'walk',
  'swim',
  'ski',
  'other',
] as const

export type Sport = (typeof SPORTS)[number]

const RESERVED = new Set<string>(SPORTS)

export const isReservedTag = (tag: string): boolean => RESERVED.has(tag.toLowerCase())

/**
 * Locale-independent sport strings as they appear inside track files:
 * GPX `<type>` (lowercase words) and TCX `Sport` (capitalised).
 */
const FROM_FILE: Record<string, Sport> = {
  running: 'run',
  run: 'run',
  jogging: 'run',
  trailrunning: 'trailrun',
  hiking: 'hike',
  hike: 'hike',
  walking: 'walk',
  walk: 'walk',
  cycling: 'ride',
  biking: 'ride',
  ride: 'ride',
  road: 'ride',
  mountainbiking: 'mtb',
  mtb: 'mtb',
  gravel: 'gravel',
  swimming: 'swim',
  swim: 'swim',
  skiing: 'ski',
  other: 'other',
}

/**
 * Maps a source's sport string to the canonical vocabulary.
 *
 * Returns null when the source said nothing, which is different from saying
 * something unrecognised: a null means "leave existing tags alone", so a manual
 * sport tag on an untyped activity survives every future import.
 */
export function toSport(raw: string | null | undefined): Sport | null {
  if (!raw) return null
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
  return FROM_FILE[key] ?? 'other'
}
