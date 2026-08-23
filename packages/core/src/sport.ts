/**
 * Canonical sport vocabulary, deliberately coarse: three activities plus a
 * landing spot for anything recognised but outside them.
 *
 * These names are RESERVED. They are written automatically from the source's own
 * sport string, so the UI must refuse a manual tag using one of them — otherwise
 * a re-derivation would silently eat it.
 */
export const SPORTS = ['bike', 'hike', 'run', 'other'] as const

export type Sport = (typeof SPORTS)[number]

const RESERVED = new Set<string>(SPORTS)

export const isReservedTag = (tag: string): boolean => RESERVED.has(tag.toLowerCase())

/**
 * Sport strings as sources report them, all locale-independent: GPX `<type>`,
 * TCX `Sport`, and Komoot's `sport` field.
 *
 * Finer distinctions are collapsed on purpose. Komoot separates `touringbicycle`
 * from `racebike` while Strava's files say only `cycling`, so keeping them apart
 * would make the two sources incomparable. Where the difference matters, a manual
 * tag adds it back.
 */
const VOCABULARY: Record<string, Sport> = {
  // --- bike ---
  cycling: 'bike',
  biking: 'bike',
  ride: 'bike',
  bike: 'bike',
  touringbicycle: 'bike',
  racebike: 'bike',
  citybike: 'bike',
  mtb: 'bike',
  mtbeasy: 'bike',
  mtbadvanced: 'bike',
  downhillbike: 'bike',
  mountainbiking: 'bike',
  emtb: 'bike',
  etouringbicycle: 'bike',
  eracebike: 'bike',
  ecitybike: 'bike',
  unicycle: 'bike',

  // --- hike ---
  hiking: 'hike',
  hike: 'hike',
  mountaineering: 'hike',
  walking: 'hike',
  walk: 'hike',
  nordicwalking: 'hike',

  // --- run ---
  running: 'run',
  run: 'run',
  jogging: 'run',
  trailrunning: 'run',

  other: 'other',
}

/**
 * Maps a source's sport string to the canonical vocabulary.
 *
 * Returns null when the source said nothing, which is different from saying
 * something unrecognised: null means "leave existing tags alone", so a manual
 * sport tag on an untyped activity survives every future import.
 */
export function toSport(raw: string | null | undefined): Sport | null {
  if (!raw) return null
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
  return VOCABULARY[key] ?? 'other'
}
