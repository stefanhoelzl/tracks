/** tz-lookup ships no types; it exports a single lat/lon -> IANA zone function. */
declare module 'tz-lookup' {
  export default function tzLookup(lat: number, lon: number): string
}
