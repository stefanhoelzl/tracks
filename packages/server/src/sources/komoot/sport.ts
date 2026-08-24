/**
 * Komoot's `sport` field, mapped to a `sport:` tag.
 *
 * Komoot's vocabulary is far finer than the canonical one — `touringbicycle`,
 * `racebike` and `mtb` are three sports here and one on Strava. Collapsing them is
 * deliberate: keeping them apart would make the two accounts incomparable, and
 * where the difference matters a manual tag adds it back.
 *
 * This map is Komoot's alone. The Strava source keeps its own copy of the words
 * they happen to share, so either can change without touching the other.
 */
const SPORTS: Record<string, string> = {
  // --- bike ---
  touringbicycle: 'bike',
  racebike: 'bike',
  citybike: 'bike',
  mtb: 'bike',
  mtb_easy: 'bike',
  mtb_advanced: 'bike',
  downhillbike: 'bike',
  e_touringbicycle: 'bike',
  e_racebike: 'bike',
  e_citybike: 'bike',
  e_mtb: 'bike',
  unicycle: 'bike',

  // --- hike ---
  hike: 'hike',
  mountaineering: 'hike',
  nordicwalking: 'hike',

  // --- run ---
  jogging: 'run',
  running: 'run',
}

/**
 * Empty when Komoot said nothing, and equally empty when it said something this map
 * does not know — an unmapped sport derives no tag and reads as *not set*, which is
 * where you look to find a gap in this table.
 */
export function sportTags(sport: string | null | undefined): string[] {
  const value = sport ? SPORTS[sport.trim().toLowerCase()] : undefined
  return value ? [`sport:${value}`] : []
}
