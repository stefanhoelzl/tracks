import tzLookup from 'tz-lookup'

/**
 * Seconds east of UTC at a given instant and place.
 *
 * Nothing in a Strava archive records an offset — the CSV date is UTC and matches
 * the GPX `Z` timestamp exactly — so it is derived from the track itself. The
 * coordinates give an IANA zone, and the zone plus the actual date gives the
 * offset with DST handled.
 */
export function utcOffsetAt(lat: number, lon: number, instant: Date): number {
  const zone = tzLookup(lat, lon)
  return offsetSeconds(zone, instant)
}

/** Parses the `GMT+02:00` form that `timeZoneName: 'longOffset'` produces. */
export function offsetSeconds(zone: string, instant: Date): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).format(instant)

  const match = formatted.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!match) return 0 // 'GMT' with no offset means UTC exactly.

  const [, sign, hours, minutes] = match
  const magnitude = Number(hours) * 3600 + Number(minutes) * 60
  return sign === '-' ? -magnitude : magnitude
}
