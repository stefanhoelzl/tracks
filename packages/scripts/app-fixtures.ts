/**
 * The fixtures that pin the Kotlin ports in `app/shared` to the TypeScript they port.
 *
 *     pnpm fixtures:app
 *
 * The phone and the web meet in exactly four places — the plan fragment, the polyline codec,
 * the scalar codec and the import frame — and in each the TypeScript is the reference. So
 * agreement is not written by hand on either side: this runs the TypeScript over a set of
 * inputs chosen for their edges (halves, wraps, malformed escapes, truncated streams) and
 * writes what it answered, and the Kotlin tests read those answers and have to match them.
 *
 * `app-fixtures.test.ts` regenerates them in memory and compares with what is committed,
 * so a change to a codec that is not carried to the Kotlin fails the TypeScript suite first.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import polyline from '@mapbox/polyline'
import {
  ALTITUDE_SCALE,
  altitudesFromScalars,
  altitudesToScalars,
  decodeScalars,
  encodeScalars,
  IMPORT_PRECISION,
  importFrameSchema,
  TRACK_PRECISION,
} from '@tracks/core'
import { PROFILES, type Waypoint } from '@tracks/routing'
import { DEFAULT_PROFILE, formatPlan, type Plan, parsePlan } from '../web/src/lib/plan.ts'

export const FIXTURE_DIR = fileURLToPath(
  new URL('../../app/shared/src/commonTest/fixtures/', import.meta.url),
)

type Pair = [number, number]

/** mulberry32: the same walk on every machine, so the fixtures only change when a codec does. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A plausible track near Innsbruck, at full GPS resolution. */
function walk(points: number, seed: number): Pair[] {
  const next = random(seed)
  const out: Pair[] = []
  let lat = 47.2654
  let lon = 11.3931
  for (let i = 0; i < points; i++) {
    lat += (next() - 0.5) * 0.0004
    lon += (next() - 0.5) * 0.0004
    out.push([Number(lat.toFixed(7)), Number(lon.toFixed(7))])
  }
  return out
}

function attempt<T>(run: () => T): { value: T } | { error: string } {
  try {
    return { value: run() }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

function polylineFixture() {
  const google: Pair[] = [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]
  const encode = [
    { precision: 5, points: [] as Pair[] },
    { precision: 5, points: google },
    { precision: 6, points: google },
    // Halves: Python 2 rounds them away from zero, JavaScript's Math.round would not.
    {
      precision: 5,
      points: [
        [0.000005, -0.000005],
        [-0.000015, 0.000025],
        [0.000025, -0.000035],
      ] as Pair[],
    },
    {
      precision: 6,
      points: [
        [90, 180],
        [-90, -180],
        [0, 0],
      ] as Pair[],
    },
    // More digits than the precision carries.
    {
      precision: 6,
      points: [
        [48.13741812, 11.57554491],
        [48.1374185, 11.5755445],
      ] as Pair[],
    },
    {
      precision: 0,
      points: [
        [47.5, 11.5],
        [-47.5, -11.5],
      ] as Pair[],
    },
    // Past 2^31 once doubled, so every bitwise operator wraps.
    {
      precision: 7,
      points: [
        [89.9999999, 179.9999999],
        [-89.9999999, -179.9999999],
      ] as Pair[],
    },
    { precision: 6, points: walk(500, 1) },
    { precision: 5, points: walk(50, 2) },
  ].map(({ precision, points }) => ({
    precision,
    points,
    encoded: polyline.encode(points, precision),
  }))

  // Malformed strings decode to something rather than throwing; the phone must agree on what.
  const malformed = ['_p~iF~ps|', '_', '?', '??', ' ', '~', 'A B', 'ÿÿ', '_p~iF']
  const decode = [
    ...encode.map(({ precision, encoded }) => ({ precision, encoded })),
    ...malformed.map((encoded) => ({ precision: 5, encoded })),
  ].map(({ precision, encoded }) => ({
    precision,
    encoded,
    points: polyline.decode(encoded, precision),
  }))

  return { encode, decode }
}

function trackCodecFixture() {
  const next = random(5)
  let altitude = 5_120
  const altitudes = Array.from({ length: 300 }, (_, i) => {
    altitude += Math.round((next() - 0.45) * 20)
    return i % 37 === 11 ? null : altitude
  })
  const times = Array.from({ length: 300 }, (_, i) => (i % 53 === 7 ? null : i * 4 + (i % 3)))

  const encode = [
    [],
    [0],
    [0, 1, 2, 3, 100, 1000, 100_000],
    [-500, -100, 0, 100, -100, -100_000],
    [null, 10, null, null, 20, null],
    [null, null],
    [100, null, null, null, 101],
    // Where the 32-bit operators start to wrap.
    [2 ** 28, -(2 ** 28)],
    [2 ** 29, -(2 ** 29), 0],
    [2 ** 30, -(2 ** 30)],
    [2 ** 31 - 1, -(2 ** 31)],
    [2 ** 40, 3],
    altitudes,
    times,
  ].map((values) => ({ values, encoded: encodeScalars(values) }))

  const malformed = ['_', ' ', '?_', '@~', '~~~~~~~~~~~~?', '??>']
  const decode = [...encode.map(({ encoded }) => encoded), ...malformed].map((encoded) => {
    const result = attempt(() => decodeScalars(encoded))
    return 'value' in result ? { encoded, values: result.value } : { encoded, error: result.error }
  })

  const toScalars = [
    [512.34, -0.25, 2.45, 0.05, -2.55, null, 100_000.05, 0.049999999999999996, -0.05, 8848.86],
    [],
  ].map((metres) => ({ metres, scalars: altitudesToScalars(metres) }))
  const fromScalars = [[5123, -2, null, 0, 1, 88_489, -4305], []].map((scalars) => ({
    scalars,
    metres: altitudesFromScalars(scalars),
  }))

  return {
    TRACK_PRECISION,
    ALTITUDE_SCALE,
    encode,
    decode,
    altitudesToScalars: toScalars,
    altitudesFromScalars: fromScalars,
  }
}

function planFixture() {
  const poi = (lat: number, lon: number, name: string | null = null): Waypoint => ({
    lat,
    lon,
    kind: 'poi',
    name,
  })
  const shaping = (lat: number, lon: number): Waypoint => ({
    lat,
    lon,
    kind: 'routing',
    name: null,
  })

  const plans: Plan[] = [
    { name: '', profile: DEFAULT_PROFILE, waypoints: [] },
    { name: 'Only a name', profile: 'trekking', waypoints: [] },
    { name: '', profile: 'gravel', waypoints: [] },
    {
      name: 'Ötztal loop',
      profile: 'gravel',
      waypoints: [
        poi(47.2654, 11.3931, 'Start'),
        shaping(47.2678, 11.3952),
        poi(47.2668, 11.3975, 'Gasthof'),
      ],
    },
    { name: '', profile: 'road', waypoints: [poi(48.1374, 11.5755), poi(47.2692, 11.3928, '')] },
    {
      name: 'a&b=c+d%e/f?g#h i',
      profile: 'hiking',
      waypoints: [poi(46.4983, 11.3548, 'Gasthof, Vent | Hütte'), shaping(46.5, 11.36)],
    },
    {
      name: '🚲 ride ☕',
      profile: 'mtb',
      waypoints: [poi(-33.8688, 151.2093, "L'Écluse ~*-._!'()")],
    },
    { name: '\ud800 lone', profile: 'trekking', waypoints: [] },
    { name: '', profile: 'trekking', waypoints: [shaping(0.000005, -0.000005)] },
    {
      name: 'walk',
      profile: 'trekking',
      waypoints: walk(40, 3).map(([lat, lon], i) =>
        i % 5 === 0 ? poi(lat, lon, `Stop ${i}`) : shaping(lat, lon),
      ),
    },
  ]
  const format = plans.map((plan) => ({ plan, fragment: formatPlan(plan) }))

  const hashes = [
    ...format.map(({ fragment }, i) => (i % 2 === 0 ? `#${fragment}` : fragment)),
    '',
    '#',
    '#name=Just%20a%20name',
    '#at=&name=y',
    '?at=_p~iF~ps%7CU&kinds=pp',
    '#?at=_p~iF~ps%7CU&kinds=pp&poi=A&poi=B',
    '#at=_p~iF~ps|U&kinds=pp',
    '#at=_p~iF~ps%7CU&kinds=p',
    '#at=_p~iF~ps%7CU&kinds=ppp',
    '#at=_p~iF~ps%7CU&kinds=pr&profile=car',
    '#at=_p~iF~ps%7CU&kinds=pX',
    '#at=_p~iF~ps%7CU&kinds=pp&poi=Only',
    '#at=_p~iF&kinds=p',
    '#name=%ZZ%4&name=second',
    '#name=%C3',
    '#name=%F0%9F%9A',
    '#name=%ED%A0%80',
    '#name=%C0%AF',
    '#name=%F4%90%80%80x',
    '#name=a+b%2Bc',
    '#&&name=x&&',
    '#=value&name',
    '#name==eq',
    '#name=Caf%C3%A9&at=_p~iF~ps%7CU&kinds=rr',
    '#name=ümlaut raw',
    '#name=\ud83d',
  ]
  const parse = hashes.map((hash) => {
    const result = attempt(() => parsePlan(hash))
    return 'value' in result ? { hash, plan: result.value } : { hash, error: result.error }
  })

  return { profiles: PROFILES, defaultProfile: DEFAULT_PROFILE, format, parse }
}

function importFixture() {
  const track = walk(20, 4)
  const base = {
    source: 'tracks',
    externalId: 'ride-2026-09-14',
    title: 'Almenrunde',
    startedAt: '2026-09-14T06:12:00.000Z',
    distanceM: 42_195.5,
    durationS: 7200,
    elapsedS: 8123,
    elevationGainM: 812,
    tags: ['sport:bike'],
    geometry: polyline.encode(track, IMPORT_PRECISION),
    altitudes: track.map((_, i) => (i === 7 ? null : 600 + i * 1.5)),
    times: track.map((_, i) => (i === 9 ? null : i * 4)),
  }
  const without = (key: keyof typeof base) => {
    const { [key]: _, ...rest } = base
    return rest
  }

  const variants: Array<[string, unknown]> = [
    ['a complete frame', base],
    [
      'every nullable field null',
      {
        ...base,
        title: null,
        distanceM: null,
        durationS: null,
        elapsedS: null,
        elevationGainM: null,
        altitudes: null,
        times: null,
      },
    ],
    ['no tags', { ...base, tags: [] }],
    ['an unknown key', { ...base, device: 'iPhone12,8' }],
    ['nulls inside the arrays', { ...base, altitudes: [null, 1.5], times: [null, 3] }],
    ['negative, fractional and huge numbers', { ...base, distanceM: -0.5, elevationGainM: 1e21 }],
    ['an empty title', { ...base, title: '' }],
    ['a one-unit source', { ...base, source: 'x' }],
    ['a unicode title', { ...base, title: 'Ötztaler Radmarathon 🚴' }],
    ['the largest safe integer', { ...base, durationS: 2 ** 53 - 1 }],
    ['one past the largest safe integer', { ...base, durationS: 2 ** 53 }],
    ['a fractional duration', { ...base, durationS: 1.5 }],
    ['a fractional time', { ...base, times: [0, 1.5] }],
    ['a duration as a string', { ...base, durationS: '7200' }],
    ['a distance as a boolean', { ...base, distanceM: true }],
    ['an empty source', { ...base, source: '' }],
    ['an empty external id', { ...base, externalId: '' }],
    ['an empty geometry', { ...base, geometry: '' }],
    ['a missing title', without('title')],
    ['a missing times', without('times')],
    ['a missing start', without('startedAt')],
    ['a tag that is not a string', { ...base, tags: [1] }],
    ['altitudes that are not an array', { ...base, altitudes: 'x' }],
    ['a title that is a number', { ...base, title: 42 }],
    ['an array', [base]],
    ['null', null],
    ['a string', 'frame'],
  ]

  const frames = variants.map(([name, input]) => {
    const result = importFrameSchema.safeParse(input)
    return result.success
      ? { name, input, valid: true, output: result.data }
      : { name, input, valid: false }
  })

  return { IMPORT_PRECISION, frames }
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

export function generateAppFixtures(): Record<string, string> {
  return {
    'polyline.json': json(polylineFixture()),
    'track-codec.json': json(trackCodecFixture()),
    'plan.json': json(planFixture()),
    'import.json': json(importFixture()),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  for (const [name, content] of Object.entries(generateAppFixtures())) {
    writeFileSync(join(FIXTURE_DIR, name), content)
    console.log(`wrote ${join(FIXTURE_DIR, name)}`)
  }
}
