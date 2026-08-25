/**
 * SI in, metric display out.
 *
 * The wire carries metres, seconds and metres per second because those are the
 * column units. Every conversion lives here, so there is one place a rounding rule
 * is decided and one place to look when a number reads oddly.
 */

/**
 * Thin spaces between thousands: `1 827`, as the design canvas sets them.
 *
 * Grouped by hand rather than through `Intl`, whose separator for a locale is an ICU
 * detail that differs between runtimes — a comma on one, a narrow no-break space on
 * another. This app wants that exact character everywhere, whatever it runs on.
 */
const THIN_SPACE = '\u202f'

export function group(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
}

export function km(metres: number | null, digits = 1): string {
  if (metres === null) return '—'
  return (metres / 1000).toFixed(digits)
}

export function metres(value: number | null): string {
  if (value === null) return '—'
  return group(Math.round(value))
}

/** `7:33` for hours, `48:20` for a sub-hour activity — never `0:48:20`. */
export function duration(seconds: number | null): string {
  if (seconds === null) return '—'

  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  if (hours === 0) return `${minutes}:${String(total % 60).padStart(2, '0')}`
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

export function kmh(metresPerSecond: number | null, digits = 1): string {
  if (metresPerSecond === null) return '—'
  return (metresPerSecond * 3.6).toFixed(digits)
}

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' })
const LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

/**
 * A local date is already the right calendar day, so it is formatted as UTC —
 * running it through the viewer's zone is what would shift it back off by one.
 */
function asUtc(localDate: string): Date {
  return new Date(`${localDate}T12:00:00Z`)
}

export function shortDate(localDate: string): string {
  return SHORT_DATE.format(asUtc(localDate))
}

export function longDate(localDate: string): string {
  return LONG_DATE.format(asUtc(localDate))
}

/** `06:42 local · UTC+2` — the detail header's second line. */
export function localTime(startedAt: string, utcOffset: number): string {
  const local = new Date(new Date(startedAt).getTime() + utcOffset * 1000)
  const time = local.toISOString().slice(11, 16)

  const sign = utcOffset < 0 ? '-' : '+'
  const hours = Math.abs(utcOffset) / 3600
  const zone = Number.isInteger(hours) ? String(hours) : hours.toFixed(1)

  return `${time} local · UTC${sign}${zone}`
}

/** What a range slider writes above its track. Units differ per facet. */
export const RANGE_UNITS = {
  distance: { label: 'Distance', unit: 'km', format: (v: number) => km(v, 0) },
  elevation: { label: 'Elevation gain', unit: 'm', format: (v: number) => metres(v) },
  duration: { label: 'Duration', unit: 'h', format: (v: number) => duration(v) },
  speed: { label: 'Average speed', unit: 'km/h', format: (v: number) => kmh(v, 0) },
} as const
