/**
 * The fixtures that pin the Kotlin ports in `app/shared` to the TypeScript they port.
 *
 *     pnpm fixtures:app
 *
 * The phone and the web meet wherever the phone does what the web does — the plan fragment and
 * its editing, the codecs, the import frame, and reading BRouter's and Photon's answers — and
 * in each the TypeScript is the reference. So
 * agreement is not written by hand on either side: this runs the TypeScript over a set of
 * inputs chosen for their edges (halves, wraps, malformed escapes, truncated streams) and
 * writes what it answered, and the Kotlin tests read those answers and have to match them.
 *
 * `app-fixtures.test.ts` regenerates them in memory and compares with what is committed,
 * so a change to a codec that is not carried to the Kotlin fails the TypeScript suite first.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
import { descentOf, type Leg, PROFILES, stretches, type Waypoint } from '@tracks/routing'
import { lonlatsOf, PROFILE_FILES, routedLeg } from '../routing/src/brouter/index.ts'
import { placesFrom, reverseParams, searchParams } from '../routing/src/photon/index.ts'
import { gradeColour } from '../web/src/lib/chart-theme.ts'
import { duration, km, metres } from '../web/src/lib/format.ts'
import {
  cumulativeDistances,
  drawnIndices,
  gradients,
  nearestInSorted,
  nearestOnPath,
} from '../web/src/lib/geo.ts'
import { DEFAULT_PROFILE, formatPlan, type Plan, parsePlan } from '../web/src/lib/plan.ts'
import {
  addWaypoint,
  derivedName,
  insertionAt,
  kindIsAChoice,
  legCount,
  legLabel,
  moveStop,
  moveWaypoint,
  nearestLeg,
  placementAt,
  poiIndices,
  removeWaypoint,
  setKind,
} from '../web/src/lib/plan-ops.ts'
import {
  cumulative,
  legGeometries,
  planBounds,
  planTotals,
  planTrack,
  readingsFrom,
} from '../web/src/lib/plan-track.ts'

export const FIXTURE_DIR = fileURLToPath(
  new URL('../../app/shared/src/commonTest/fixtures/', import.meta.url),
)

/** Where the recorded answers live; the Kotlin reads the same files by these paths. */
const REPO = fileURLToPath(new URL('../../', import.meta.url))
const repoJson = (path: string): unknown => JSON.parse(readFileSync(join(REPO, path), 'utf8'))

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

function stop(lat: number, lon: number, name: string | null = null): Waypoint {
  return { lat, lon, kind: 'poi', name }
}

function hint(lat: number, lon: number): Waypoint {
  return { lat, lon, kind: 'routing', name: null }
}

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i)

/**
 * Legs for a plan, the way a router might have answered it: `r` routed, `f` failed and
 * `u` still out, cycling through `shape` leg by leg. Routed ones wander between their
 * waypoints so that *nearest* and *along* have a real line to measure against.
 */
function legsFor(
  waypoints: readonly Waypoint[],
  shape: string,
  seed: number,
): Array<Leg | undefined> {
  const next = random(seed)
  const round = (value: number) => Number(value.toFixed(6))

  return stretches(waypoints).map((stretch, index): Leg | undefined => {
    const from = stretch[0]
    const to = stretch[stretch.length - 1]
    if (!from || !to) throw new Error('a stretch has two ends')

    const mode = shape[index % shape.length]
    if (mode === 'u') return undefined
    if (mode === 'f') {
      return {
        ok: false,
        from,
        to,
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
        reason: `No route to stop ${index + 1}`,
      }
    }

    const coordinates: Array<[number, number]> = []
    stretch.forEach((a, s) => {
      const b = stretch[s + 1]
      if (!b) return
      for (let k = 0; k < 4; k++) {
        const t = k / 4
        const wobble = k === 0 ? 0 : (next() - 0.5) * 0.004
        coordinates.push([
          round(a.lon + (b.lon - a.lon) * t + wobble),
          round(a.lat + (b.lat - a.lat) * t - wobble),
        ])
      }
    })
    coordinates.push([to.lon, to.lat])

    const altitudeM = coordinates.map(() => Math.round(5000 + next() * 15_000) / 10)
    const ascentM = Math.round(next() * 8000) / 10
    return {
      ok: true,
      from,
      to,
      coordinates,
      altitudeM,
      distanceM: Math.round(1000 + next() * 50_000),
      ascentM,
      descentM: descentOf(ascentM, altitudeM),
      durationS: Math.round(next() * 20_000),
    }
  })
}

function planEditFixture() {
  const plan = (waypoints: Waypoint[]): Plan => ({ name: '', profile: 'trekking', waypoints })
  const walked = walk(14, 7).map(([lat, lon], i) =>
    i % 4 === 0 || i === 13 ? stop(lat, lon, i === 13 ? null : `Stop ${i}`) : hint(lat, lon),
  )

  // `sweep` tries every edit at every index; the walk is too long for that to stay readable.
  const scenarios = [
    { name: 'empty', plan: plan([]), shape: 'r', sweep: true },
    {
      name: 'one stop',
      plan: plan([stop(47.2654, 11.3931, 'Innsbruck')]),
      shape: 'r',
      sweep: true,
    },
    {
      name: 'one stop and a hint',
      plan: plan([stop(47.2654, 11.3931, 'Innsbruck'), hint(47.28, 11.42)]),
      shape: 'r',
      sweep: true,
    },
    {
      name: 'two stops',
      plan: plan([stop(47.2654, 11.3931, 'Innsbruck'), stop(47.2692, 11.4928)]),
      shape: 'r',
      sweep: true,
    },
    {
      name: 'hints inside and outside the legs',
      plan: plan([
        hint(47.25, 11.35),
        stop(47.2654, 11.3931, 'Start'),
        hint(47.27, 11.41),
        hint(47.275, 11.43),
        stop(47.28, 11.45),
        hint(47.29, 11.47),
        stop(47.3, 11.5, 'End'),
        hint(47.31, 11.52),
      ]),
      shape: 'rf',
      sweep: true,
    },
    {
      name: 'routed, failed and in flight',
      plan: plan([
        stop(46.8600108, 10.9146696, 'Vent'),
        stop(46.87, 10.95, 'Hütte'),
        hint(46.9, 10.97),
        stop(46.95, 11.0),
        stop(47.0, 11.05, 'Sölden'),
        stop(47.05, 11.1, 'Längenfeld'),
      ]),
      shape: 'rfur',
      sweep: true,
    },
    { name: 'a walk', plan: plan(walked), shape: 'rrfu', sweep: false },
  ]

  const tapsFor = (waypoints: readonly Waypoint[], seed: number) => {
    const next = random(seed)
    const taps = [
      { lat: 47.2, lon: 11.3 },
      { lat: -33.8, lon: 151.2 },
    ]
    for (const w of waypoints.slice(0, 3)) taps.push({ lat: w.lat, lon: w.lon })
    for (let i = 0; i < 4; i++) {
      const base = waypoints[Math.floor(next() * waypoints.length)]
      if (!base) continue
      taps.push({
        lat: Number((base.lat + (next() - 0.5) * 0.05).toFixed(6)),
        lon: Number((base.lon + (next() - 0.5) * 0.05).toFixed(6)),
      })
    }
    return taps
  }

  const edits = (p: Plan) => {
    const n = p.waypoints.length
    const stops = poiIndices(p.waypoints).length
    return {
      added: [-1, 0, 1, n, n + 3].map((index) => ({
        index,
        plan: addWaypoint(p, stop(47.1, 11.2, 'New'), index),
      })),
      removed: range(-1, n + 1).map((index) => ({ index, plan: removeWaypoint(p, index) })),
      kinds: range(-1, n + 1).flatMap((index) =>
        (['poi', 'routing'] as const).map((kind) => ({
          index,
          kind,
          plan: setKind(p, index, kind),
        })),
      ),
      moved: range(-1, n + 1).map((index) => ({
        index,
        plan: moveWaypoint(p, index, { lat: 47.123456, lon: 11.654321 }),
      })),
      // Every stop to either end, to its neighbours and to itself, and out of range both ways.
      stops: range(-1, stops + 1).flatMap((from) =>
        [...new Set([-1, 0, from - 1, from, from + 1, stops - 1, stops])].map((to) => ({
          from,
          to,
          plan: moveStop(p, from, to),
        })),
      ),
    }
  }

  const paths: Array<Array<[number, number]>> = [
    [],
    [[11.39, 47.26]],
    [
      [11.39, 47.26],
      [11.39, 47.26],
    ],
    [
      [11.39, 47.26],
      [11.45, 47.3],
      [11.39, 47.26],
    ],
    walk(12, 9).map(([lat, lon]): [number, number] => [lon, lat]),
    [
      [179.9, -60],
      [-179.9, -60],
    ],
  ]
  const points: Array<[number, number]> = [
    [11.39, 47.26],
    [11.42, 47.28],
    [11.3, 47.1],
    [0, 0],
    [179.95, -60.01],
  ]

  return {
    scenarios: scenarios.map(({ name, plan: p, shape, sweep }, index) => {
      const legs = legsFor(p.waypoints, shape, 100 + index)
      const legTotal = legCount(p)
      const track = planTrack(legs)
      return {
        name,
        plan: p,
        legs,
        poiIndices: poiIndices(p.waypoints),
        derivedName: derivedName(p),
        legCount: legTotal,
        kindIsAChoice: kindIsAChoice(p),
        legLabels: range(-1, legTotal + 1).map((leg) => ({ leg, label: legLabel(p, leg) })),
        taps: tapsFor(p.waypoints, 200 + index).map((at) => {
          const nearest = nearestLeg(p, legs, at)
          return {
            at,
            nearestLeg: nearest,
            insertions: range(-1, legTotal + 1).map((leg) => ({
              leg,
              index: insertionAt(p, legs, leg, at),
            })),
            start: placementAt(p, legs, 'start', nearest, at),
            end: placementAt(p, legs, 'end', nearest, at),
            nearest: placementAt(p, legs, 'nearest', nearest, at),
            unplaced: placementAt(p, legs, 'nearest', null, at),
          }
        }),
        ...(sweep ? edits(p) : {}),
        geometries: legGeometries(p.waypoints, legs),
        totals: planTotals(legs),
        track: { coordinates: track.coordinates, altitudeM: track.altitudeM },
        cumulative: cumulative(legs),
        readings: range(-1, legTotal + 2).map((base) => ({
          base,
          readings: readingsFrom(legs, base),
        })),
        bounds: planBounds(p.waypoints, legs),
      }
    }),
    // An empty path answers an infinite distance, which JSON carries as null.
    nearestOnPath: paths.flatMap((path) =>
      points.map(([lon, lat]) => ({ path, lon, lat, hit: nearestOnPath(path, lon, lat) })),
    ),
  }
}

function brouterFixture() {
  // BRouter's own grammar back into waypoints: a name is a via, `m` an unnamed one, bare is shaping.
  const waypointsOf = (lonlats: string): Waypoint[] =>
    lonlats.split('|').map((part) => {
      const [lon, lat, name] = part.split(',')
      if (name === undefined) return hint(Number(lat), Number(lon))
      return stop(Number(lat), Number(lon), name === 'm' ? null : name)
    })
  const route = (id: string) => {
    const row = readFileSync(join(REPO, 'app/brouter/parity/routes.tsv'), 'utf8')
      .split('\n')
      .map((line) => line.split('\t'))
      .find(([name]) => name === id)
    if (!row?.[2]) throw new Error(`no parity route ${id}`)
    return row[2]
  }

  const ends = (stretch: Waypoint[]) => {
    const from = stretch[0]
    const to = stretch[stretch.length - 1]
    if (!from || !to) throw new Error('a stretch has two ends')
    return { from, to }
  }
  const file = (path: string, stretch: Waypoint[]) => {
    const { from, to } = ends(stretch)
    return { file: path, from, to, leg: routedLeg(from, to, repoJson(path)) }
  }

  const track = (
    properties: Record<string, unknown>,
    coordinates: unknown = [
      [11.39, 47.26, 574.5],
      [11.4, 47.27],
    ],
    geometryType = 'LineString',
    type = 'FeatureCollection',
  ) => ({
    type,
    features: [{ type: 'Feature', geometry: { type: geometryType, coordinates }, properties }],
  })
  const good = { 'track-length': '893', 'filtered ascend': '1', 'total-time': '154' }
  const bodies: unknown[] = [
    track(good),
    track({ ...good, 'track-length': 893.5, 'filtered ascend': ' 12 ', 'total-time': '1e3' }),
    track({ ...good, 'track-length': '', 'filtered ascend': null, 'total-time': true }),
    track({ ...good, 'track-length': '0x1F', 'filtered ascend': '+.5', 'total-time': '5.' }),
    track({ ...good, 'track-length': '﻿\n 7  ' }),
    track({ ...good, 'track-length': 'abc' }),
    track({ ...good, 'track-length': 'Infinity' }),
    track({ ...good, 'track-length': '1e400' }),
    track({ ...good, 'track-length': '1_000' }),
    track({ 'track-length': '1', 'filtered ascend': '1' }),
    track(good, [
      [11.39, 47.26, 574.5, 9],
      [11.4, 47.27, 580],
    ]),
    track(good, [[11.39, 47.26], [11.4]]),
    track(good, [[11.39, '47.26']]),
    track(good, []),
    track(good, undefined, 'Point'),
    track(good, undefined, 'LineString', 'Feature'),
    { type: 'FeatureCollection', features: [] },
    { type: 'FeatureCollection', features: [track(good).features[0], { geometry: null }] },
    [],
    null,
    'track',
  ]
  const { from, to } = ends([stop(47.2654, 11.3931, 'Start'), stop(47.2668, 11.3975, 'Ende')])

  const stretchCases: Waypoint[][] = [
    [],
    [hint(47, 11)],
    [stop(47, 11)],
    [stop(47, 11, 'A'), stop(47.1, 11.1)],
    [
      hint(46.9, 10.9),
      stop(47, 11, 'A'),
      hint(47.01, 11.01),
      hint(47.02, 11.02),
      stop(47.1, 11.1),
      hint(47.11, 11.11),
      stop(47.2, 11.2, 'C'),
      hint(47.3, 11.3),
    ],
    [stop(47, 11, 'A'), hint(47.01, 11.01), hint(47.02, 11.02)],
    [hint(47, 11), hint(47.1, 11.1)],
  ]
  const descents: Array<[number, number[]]> = [
    [100, [500, 520, 480]],
    [100, [500, 600]],
    [10, [500, 700]],
    [0, []],
    [5.5, [512.25]],
    [12, [100, 90.5]],
  ]

  return {
    profileFiles: PROFILE_FILES,
    stretches: stretchCases.map((waypoints) => ({ waypoints, stretches: stretches(waypoints) })),
    descents: descents.map(([ascentM, altitudeM]) => ({
      ascentM,
      altitudeM,
      descentM: descentOf(ascentM, altitudeM),
    })),
    lonlats: [
      [stop(47.2654, 11.3931, 'Start'), stop(47.2668, 11.3975, 'Ende')],
      [stop(48.1374, 11.5755), hint(48, 11.5), stop(47.2692, 11.3928, '')],
      [stop(46.4983, 11.3548, 'Gasthof, Vent | Hütte; oben'), stop(47, 11, '  ,|; ')],
      [stop(0.00001, -0.000001, 'tiny'), hint(-89.99999, 179.99999), stop(1e-7, 180, '﻿ x ')],
      waypointsOf(route('trekking-named-via')),
    ].map((stretch) => ({ stretch, lonlats: lonlatsOf(stretch) })),
    files: [
      file('fixtures/brouter/leg-trekking.json', [
        stop(47.2654, 11.3931, 'Start'),
        stop(47.2668, 11.3975, 'Ende'),
      ]),
      file('fixtures/brouter/leg-shaped.json', [
        stop(47.2654, 11.3931, 'Start'),
        stop(47.2668, 11.3975, 'Ende'),
      ]),
      file(
        'app/brouter/parity/brouter.de/trekking-salzburg-hallein.geojson',
        waypointsOf(route('trekking-salzburg-hallein')),
      ),
    ],
    bodies: bodies.map((body) => {
      const result = attempt(() => routedLeg(from, to, body))
      return 'value' in result ? { body, leg: result.value } : { body, error: result.error }
    }),
  }
}

function photonFixture() {
  const feature = (
    properties: Record<string, unknown>,
    coordinates: unknown = [11.39315, 47.26545],
  ) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties })
  const bodies: unknown[] = [
    { features: [] },
    {},
    { features: [feature({})] },
    { features: [feature({}, [11.00005, -47.00005])] },
    { features: [feature({ street: 'Dorfstraße', housenumber: '12', city: 'Vent' })] },
    { features: [feature({ street: 'Dorfstraße', housenumber: '' })] },
    { features: [feature({ name: '', city: '', county: 'Imst' })] },
    {
      features: [
        feature({
          name: 'Sölden',
          city: 'Sölden',
          district: 'Sölden',
          state: 'Tyrol',
          country: 'Austria',
        }),
      ],
    },
    { features: [feature({ county: 'Imst' })] },
    { features: [feature({ name: 'Vent', district: 'Sölden', county: 'Imst', osm_id: 5 })] },
    { features: [feature({ name: null })] },
    { features: [feature({ name: 5 })] },
    { features: [feature({ name: 'a' }, [11, 47, 3])] },
    { features: [feature({ name: 'a' }, ['11', 47])] },
    {
      features: [
        { ...feature({ name: 'a' }), geometry: { type: 'LineString', coordinates: [11, 47] } },
      ],
    },
    { features: [feature({ name: 'a' }), feature({ name: 'b' }), { geometry: null }] },
    [],
    null,
  ]
  const searches: Array<[string, { lat: number; lon: number } | null]> = [
    ['Vent', null],
    ['  Gasthof Vent  ', { lat: 47.26, lon: 11.39 }],
    ['', null],
    ['   ', { lat: 47.26, lon: 11.39 }],
    ['﻿a&b=c+d%e/f?g#h', { lat: 0.000001, lon: -180 }],
    ['Café 🚲', { lat: 46.8600108, lon: 10.9146696 }],
  ]

  return {
    searches: searches.map(([query, near]) => ({
      query,
      near,
      params: searchParams(query, near)?.toString() ?? null,
    })),
    reverses: [
      { lat: 47.26, lon: 11.39 },
      { lat: 1e-7, lon: 0 },
    ].map((at) => ({ at, params: reverseParams(at).toString() })),
    files: ['fixtures/photon/search-vent.json', 'fixtures/photon/reverse-innsbruck.json'].map(
      (path) => ({ file: path, places: placesFrom(repoJson(path)) }),
    ),
    bodies: bodies.map((body) => ({ body, places: placesFrom(body) })),
  }
}

/** What JavaScript makes of a number as text, and of text as a number, where the ports must agree. */
function numbersFixture() {
  const values = [
    0,
    1,
    11,
    11.5,
    -11.39,
    47.2654,
    1e-7,
    0.00001,
    0.000001,
    1.5e-10,
    1e21,
    1e20,
    123456789012345680000,
    0.1 + 0.2,
    5e-324,
    Number.MAX_VALUE,
    180,
    -180,
    46.4983,
    0.000005,
    -0.000005,
    2.5,
    1.00005,
    1.23455,
    47.26545,
    11.39315,
    -0.00001,
    99.99995,
    1234.5678,
  ]
  const texts = [
    '',
    ' ',
    '7',
    ' 7 ',
    '﻿7 ',
    '7',
    ' 7　',
    '+7',
    '-7',
    '.5',
    '5.',
    '1e3',
    '1E-3',
    '0x1F',
    '0X1f',
    '0b101',
    '0o17',
    '-0x10',
    '0x',
    '1_000',
    'abc',
    'Infinity',
    '-Infinity',
    '1e400',
    '7 7',
    '٣',
  ]
  // toFixed only where the phone's port claims to follow it: coordinates, not astronomy.
  const fixed = (value: number, digits: number) =>
    Math.abs(value) < 1e9 || Math.abs(value) >= 1e21 ? value.toFixed(digits) : null

  return {
    numbers: values.map((value) => ({
      value,
      string: String(value),
      fixed4: fixed(value, 4),
      fixed6: fixed(value, 6),
    })),
    texts: texts.map((text) => ({ text, trimmed: text.trim(), number: String(Number(text)) })),
  }
}

/** A plan's numbers as the web prints them, so the phone's list and tiles read the same. */
function formatFixture() {
  const distances: Array<[number | null, number]> = [
    [null, 1],
    [0, 1],
    [1, 1],
    [49, 1],
    [50, 1],
    [51, 1],
    [999, 0],
    [1049, 1],
    [1050, 1],
    [1051, 1],
    [12345.678, 2],
    [176000.5, 1],
    [-250, 1],
    [0.4, 0],
    [5e6, 1],
  ]
  const heights = [null, 0, 0.4, 0.5, -0.5, -0.4, 999.5, 1000, 1827.3, 12345678, -1827]
  const durations = [null, 0, 29.4, 29.5, 59.5, 3599.5, 3600, 9180, 45296, 100000]

  return {
    km: distances.map(([value, digits]) => ({ value, digits, text: km(value, digits) })),
    metres: heights.map((value) => ({ value, text: metres(value) })),
    durations: durations.map((value) => ({ value, text: duration(value) })),
  }
}

/** The elevation profile's measurements and ramp, so the phone draws a plan's terrain as the web does. */
function terrainFixture() {
  const lonLat = (points: Pair[]) => points.map(([lat, lon]): Pair => [lon, lat])
  const next = random(11)
  let height = 700
  const climb = lonLat(walk(200, 12))
  const climbHeights = climb.map((_, i) => {
    height += (next() - 0.3) * 3
    return i % 47 === 20 ? null : Number(height.toFixed(1))
  })

  const tracks: Array<{
    name: string
    coordinates: Pair[]
    altitudeM: Array<number | null>
    reportedM: number | null
  }> = [
    {
      name: 'a climb with dropouts',
      coordinates: climb,
      altitudeM: climbHeights,
      reportedM: 3050,
    },
    {
      name: 'sampled coarser than the window',
      coordinates: [
        [11.0, 47.0],
        [11.002, 47.0],
        [11.004, 47.001],
        [11.006, 47.002],
      ],
      altitudeM: [700, 712, 730, 731],
      reportedM: null,
    },
    {
      name: 'dropouts at both ends',
      coordinates: lonLat(walk(30, 13)),
      altitudeM: [null, null, ...Array.from({ length: 26 }, (_, i) => 600 + i), null, null],
      reportedM: null,
    },
    {
      name: 'flat',
      coordinates: lonLat(walk(60, 14)),
      altitudeM: Array.from({ length: 60 }, () => 500),
      reportedM: 1000,
    },
  ]

  const nearest: Array<[number[], number]> = [
    [[], 5],
    [[0], 5],
    [[0, 10, 20], 5],
    [[0, 10, 20], 4.9],
    [[0, 10, 20], 15],
    [[0, 10, 20], 25],
    [[0, 10, 20], -3],
    [[0, 10, 10, 20], 10],
  ]

  return {
    tracks: tracks.map((track) => {
      const distances = cumulativeDistances(track.coordinates, track.reportedM)
      const measured = track.altitudeM.filter((value): value is number => value !== null)
      // As ElevationProfile.tsx sets them: sub-pixel relief, and a cursor step of at most 50 m.
      const tolerance = Math.max(1, (Math.max(...measured) - Math.min(...measured)) * (1 / 400))
      const cap = Math.min(50, (distances[distances.length - 1] ?? 0) / 40)
      return {
        ...track,
        distances,
        gradients: gradients(distances, track.altitudeM),
        tolerance,
        cap,
        drawn: drawnIndices(distances, track.altitudeM, tolerance, cap),
      }
    }),
    nearest: nearest.map(([values, target]) => ({
      values,
      target,
      index: nearestInSorted(values, target),
    })),
    grades: [-20, -8, -4, 0, 0.1, 2, 4, 6, 8, 10, 11.5, 13, 15, 30].map((gradient) => ({
      gradient,
      colour: gradeColour(gradient),
    })),
  }
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

export function generateAppFixtures(): Record<string, string> {
  return {
    'polyline.json': json(polylineFixture()),
    'track-codec.json': json(trackCodecFixture()),
    'plan.json': json(planFixture()),
    'import.json': json(importFixture()),
    'plan-edit.json': json(planEditFixture()),
    'brouter.json': json(brouterFixture()),
    'photon.json': json(photonFixture()),
    'numbers.json': json(numbersFixture()),
    'format.json': json(formatFixture()),
    'terrain.json': json(terrainFixture()),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  for (const [name, content] of Object.entries(generateAppFixtures())) {
    writeFileSync(join(FIXTURE_DIR, name), content)
    console.log(`wrote ${join(FIXTURE_DIR, name)}`)
  }
}
