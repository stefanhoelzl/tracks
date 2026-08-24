/**
 * GPX `<type>` and TCX `Sport`, mapped to a `sport:` tag.
 *
 * Both are English and locale-independent, unlike the CSV's sport column — which is
 * why there is no CSV fallback and two Garmin-uploaded rides, whose files carry no
 * `<type>` at all, are tagged by hand.
 *
 * This map is the archive's alone. The Komoot source keeps its own copy of the words
 * they happen to share, so either can change without touching the other.
 */
const SPORTS: Record<string, string> = {
  // --- bike ---
  cycling: 'bike',
  biking: 'bike',
  ride: 'bike',
  bike: 'bike',
  ebikeride: 'bike',
  gravelride: 'bike',
  mountainbikeride: 'bike',
  virtualride: 'bike',

  // --- hike ---
  hiking: 'hike',
  hike: 'hike',
  walking: 'hike',
  walk: 'hike',

  // --- run ---
  running: 'run',
  run: 'run',
  trailrun: 'run',
}

/**
 * Empty when the file said nothing, and equally empty when it said something this map
 * does not know — an unmapped sport derives no tag and reads as *not set*.
 */
export function sportTags(sport: string | null | undefined): string[] {
  const key = sport
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]/g, '')
  const value = key ? SPORTS[key] : undefined
  return value ? [`sport:${value}`] : []
}
