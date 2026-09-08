/**
 * Fills a local database with an archive nobody actually rode.
 *
 *     pnpm db:seed
 *
 * For working on the app without the real data: a contributor cloning this repo, a
 * change to the map or the analytics that wants something to look at, or an afternoon
 * offline. It writes `data/dev.db`, which `pnpm dev:local` serves.
 *
 * **The tracks are real routes.** Every one is fetched from BRouter — the same router
 * `packages/routing` uses for planning — so it follows roads and trails that exist, and
 * arrives with per-point elevation, a track length, a filtered ascent and a time. Those
 * four used to be four independent random numbers that contradicted each other and the
 * geometry they were attached to; now they are one fact, and the charts are worth
 * looking at because of it.
 *
 * What is invented here is the archive around them: which routes, on which days, in
 * which order, and who they came from.
 *
 * Generated rather than committed as a fixture, because 60 tracks of several thousand
 * points each is tens of megabytes nobody would read in a diff. Deterministic all the
 * same — one seeded generator, and the only thing that moves is today's date, which the
 * archive ends a few days before so the app opens on something alive.
 *
 * It goes in through `ingestActivity`, the same path an import uses, so the polyline,
 * the bounding box, the timezone offset and the tag registry are all derived exactly as
 * they are in production rather than approximated here.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import polyline from '@mapbox/polyline'
import { IMPORT_PRECISION, type ImportFrame } from '@tracks/core'
import { BRouterRouter, type Profile, type RoutedLeg, type Waypoint } from '@tracks/routing'
import { openDb } from '@tracks/server/db.ts'
import { ingestActivity } from '@tracks/server/ingest.ts'
import { writeActivityTags } from '@tracks/server/tagging.ts'
import { utcOffsetAt } from '@tracks/server/timezone.ts'
import { sql } from 'drizzle-orm'

/** Mulberry32: three lines, and the same sequence on every machine. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const roll = random(20260908)

/** A number in `[min, max)`, which is most of what the schedule below wants. */
const between = (min: number, max: number) => min + roll() * (max - min)

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------

type Sport = 'hike' | 'bike' | 'run'

/**
 * One route, as coordinates a router can be asked about.
 *
 * `at` is `[lat, lon]` in the app's order rather than GeoJSON's, because that is the
 * order everything else here is written in. The ends are breaks and everything between
 * them shapes the line, which makes one BRouter request per route however many points
 * it has.
 *
 * Shaping points earn their place twice: a summit between two copies of a trailhead is
 * what turns a there-and-back into a loop, and a via is what keeps a long ride on the
 * road it was meant to take. They are not free, though, and the temptation is to add
 * them for safety. A point even a few hundred metres off the path drags the route over
 * a ridge — the Karwendelhaus approach came back as 63 km and 4,000 m of climbing
 * before its two invented waypoints were removed, and 16 km and 865 m after — and each
 * one is another search the public server may decide is too expensive and kill.
 *
 * So every coordinate here was looked up rather than guessed, through the Photon
 * geocoder in `packages/routing`, and then checked by fetching the route. Half the
 * summits in the first draft were two or three kilometres out.
 */
interface Route {
  title: string
  sport: Sport
  profile: Profile
  at: Array<[number, number]>
}

/** Consecutive days under one `trip:` tag. */
interface Tour {
  trip: string
  days: Route[]
}

/**
 * Eighteen runs from the door.
 *
 * They are the weekday texture — the thing that stops the calendar being a scatter of
 * weekends — and the reason the archive has anything in December.
 */
const RUNS: Route[] = [
  {
    title: 'Englischer Garten, the north half',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.159, 11.594],
      [48.1877, 11.6055],
      [48.174, 11.6],
      [48.166, 11.588],
      [48.159, 11.594],
    ],
  },
  {
    title: 'Isar down to the Flaucher',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.127, 11.576],
      [48.117, 11.566],
      [48.1094, 11.559],
      [48.1, 11.548],
      [48.112, 11.556],
      [48.127, 11.576],
    ],
  },
  {
    title: 'Olympiapark rounds',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.173, 11.551],
      [48.178, 11.556],
      [48.169, 11.548],
      [48.181, 11.545],
      [48.176, 11.559],
      [48.173, 11.551],
    ],
  },
  {
    title: 'Nymphenburg canal and back',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.158, 11.503],
      [48.158, 11.517],
      [48.149, 11.521],
      [48.146, 11.505],
      [48.161, 11.497],
      [48.158, 11.503],
    ],
  },
  {
    title: 'Westpark circuit',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.123, 11.522],
      [48.12, 11.51],
      [48.125, 11.529],
      [48.118, 11.535],
      [48.115, 11.519],
      [48.123, 11.522],
    ],
  },
  {
    title: 'Isar north to Oberföhring',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.168, 11.603],
      [48.178, 11.618],
      [48.183, 11.627],
      [48.19, 11.622],
      [48.172, 11.61],
      [48.168, 11.603],
    ],
  },
  {
    title: 'Hirschgarten and the Schloss',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.149, 11.521],
      [48.156, 11.506],
      [48.158, 11.503],
      [48.163, 11.497],
      [48.146, 11.512],
      [48.149, 11.521],
    ],
  },
  {
    title: 'Riemer Park',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.14, 11.69],
      [48.144, 11.7],
      [48.137, 11.696],
      [48.146, 11.685],
      [48.135, 11.681],
      [48.14, 11.69],
    ],
  },
  {
    title: 'Perlacher Forst',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.093, 11.568],
      [48.082, 11.576],
      [48.09, 11.586],
      [48.076, 11.56],
      [48.086, 11.554],
      [48.093, 11.568],
    ],
  },
  {
    title: 'Isar, the south bank',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.12, 11.572],
      [48.114, 11.564],
      [48.1094, 11.559],
      [48.1, 11.548],
      [48.091, 11.542],
      [48.107, 11.552],
      [48.12, 11.572],
    ],
  },
  {
    title: 'Blutenburg and the Würm',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.165, 11.462],
      [48.172, 11.472],
      [48.16, 11.468],
      [48.178, 11.455],
      [48.17, 11.45],
      [48.165, 11.462],
    ],
  },
  {
    title: 'Luitpoldpark before dark',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.172, 11.57],
      [48.179, 11.573],
      [48.174, 11.564],
      [48.183, 11.58],
      [48.166, 11.578],
      [48.172, 11.57],
    ],
  },
  {
    title: 'Ostpark laps',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.113, 11.622],
      [48.109, 11.632],
      [48.115, 11.628],
      [48.105, 11.618],
      [48.118, 11.612],
      [48.113, 11.622],
    ],
  },
  {
    title: 'Isartal towards Grünwald',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.096, 11.545],
      [48.085, 11.534],
      [48.075, 11.531],
      [48.068, 11.532],
      [48.08, 11.541],
      [48.096, 11.545],
    ],
  },
  {
    title: 'Feldmochinger See',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.21, 11.515],
      [48.218, 11.523],
      [48.212, 11.509],
      [48.222, 11.505],
      [48.204, 11.507],
      [48.21, 11.515],
    ],
  },
  {
    title: 'Fasanerie and the Angerlohe',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.201, 11.49],
      [48.208, 11.482],
      [48.197, 11.483],
      [48.21, 11.495],
      [48.194, 11.497],
      [48.201, 11.49],
    ],
  },
  {
    title: 'Englischer Garten, the south half',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.143, 11.586],
      [48.152, 11.59],
      [48.159, 11.594],
      [48.164, 11.601],
      [48.15, 11.598],
      [48.143, 11.586],
    ],
  },
  {
    title: 'The Isar islands',
    sport: 'run',
    profile: 'hiking',
    at: [
      [48.13, 11.583],
      [48.136, 11.588],
      [48.137, 11.592],
      [48.122, 11.575],
      [48.128, 11.58],
      [48.13, 11.583],
    ],
  },
]

/** Eight rides from Munich, out into the Fünfseenland and the Isar valley. */
const RIDES: Route[] = [
  {
    title: 'Isartal to Wolfratshausen',
    sport: 'bike',
    profile: 'trekking',
    at: [
      [48.096, 11.545],
      [48.068, 11.532],
      [48.0, 11.472],
      [47.96, 11.456],
      [47.911, 11.424],
      [48.027, 11.488],
      [48.096, 11.545],
    ],
  },
  {
    title: 'Starnberger See, the whole way round',
    sport: 'bike',
    profile: 'trekking',
    at: [
      [48.115, 11.54],
      [48.068, 11.376],
      [47.997, 11.341],
      [47.955, 11.303],
      [47.909, 11.281],
      [47.9, 11.352],
      [47.997, 11.341],
      [48.115, 11.54],
    ],
  },
  {
    title: 'Ammersee by way of Andechs',
    sport: 'bike',
    profile: 'trekking',
    at: [
      [48.115, 11.54],
      [48.133, 11.377],
      [48.001, 11.176],
      [47.977, 11.183],
      [47.997, 11.341],
      [48.115, 11.54],
    ],
  },
  {
    title: 'Through the Ebersberger Forst',
    sport: 'bike',
    profile: 'gravel',
    at: [
      [48.127, 11.604],
      [48.087, 11.825],
      [48.077, 11.97],
      [48.045, 11.967],
      [48.09, 11.75],
      [48.127, 11.604],
    ],
  },
  {
    title: 'Dachau and the Amper',
    sport: 'bike',
    profile: 'trekking',
    at: [
      [48.16, 11.53],
      [48.224, 11.475],
      [48.26, 11.434],
      [48.177, 11.254],
      [48.133, 11.377],
      [48.16, 11.53],
    ],
  },
  {
    title: 'Freising on the Isar path',
    sport: 'bike',
    profile: 'trekking',
    at: [
      [48.178, 11.618],
      [48.227, 11.671],
      [48.249, 11.651],
      [48.402, 11.749],
    ],
  },
  {
    title: 'Up the Isar to Bad Tölz',
    sport: 'bike',
    profile: 'trekking',
    at: [
      [48.096, 11.545],
      [48.0, 11.472],
      [47.911, 11.424],
      [47.84, 11.492],
      [47.761, 11.556],
    ],
  },
  {
    title: 'Wörthsee and the Fünfseenland',
    sport: 'bike',
    profile: 'road',
    at: [
      [48.115, 11.54],
      [48.068, 11.376],
      [48.07, 11.19],
      [48.001, 11.176],
      [47.997, 11.341],
      [48.115, 11.54],
    ],
  },
]

/**
 * Fourteen Saturdays in the Alps.
 *
 * All of them are within about two hours of Munich, which is the constraint that
 * actually shapes a Munich archive — the Karwendel, the Wetterstein, the Tegernsee
 * mountains and the Chiemgau, over and over, and nothing beyond them on a day trip.
 */
const HIKES: Route[] = [
  {
    title: 'Partnachklamm and the Eckbauer',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.489, 11.108],
      [47.478, 11.116],
      [47.4665, 11.134],
      [47.489, 11.108],
    ],
  },
  {
    title: 'Wank from Partenkirchen',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.495, 11.117],
      [47.5087, 11.143],
      [47.495, 11.117],
    ],
  },
  {
    title: 'Herzogstand above the Walchensee',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.61, 11.323],
      [47.6135, 11.3085],
      [47.61, 11.323],
    ],
  },
  {
    title: 'Jochberg from the Kesselberg',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.618, 11.34],
      [47.6259, 11.3719],
      [47.618, 11.34],
    ],
  },
  {
    title: 'Benediktenwand from Benediktbeuern',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.707, 11.412],
      [47.6532, 11.4655],
      [47.707, 11.412],
    ],
  },
  {
    title: 'Wallberg above Rottach',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.689, 11.766],
      [47.6556, 11.7887],
      [47.6659, 11.7968],
      [47.689, 11.766],
    ],
  },
  {
    title: 'Brecherspitz from the Spitzingsee',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.671, 11.887],
      [47.6764, 11.8711],
      [47.671, 11.887],
    ],
  },
  {
    title: 'Wendelstein from Bayrischzell',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.674, 12.016],
      [47.7022, 12.0123],
      [47.674, 12.016],
    ],
  },
  {
    title: 'Kampenwand from Aschau',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.775, 12.323],
      [47.762, 12.348],
      [47.7555, 12.364],
      [47.775, 12.323],
    ],
  },
  {
    title: 'Hochfelln from Bergen',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.806, 12.589],
      [47.7623, 12.5592],
      [47.806, 12.589],
    ],
  },
  {
    title: 'Rauschberg above Ruhpolding',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.766, 12.646],
      [47.733, 12.6839],
      [47.766, 12.646],
    ],
  },
  {
    title: 'Hirschberg over Kreuth',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.639, 11.742],
      [47.6608, 11.6961],
      [47.639, 11.742],
    ],
  },
  {
    title: 'Laber above Oberammergau',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.598, 11.067],
      [47.5858, 11.1022],
      [47.598, 11.067],
    ],
  },
  {
    title: 'Jenner above the Königssee',
    sport: 'hike',
    profile: 'hiking',
    at: [
      [47.59, 12.988],
      [47.5757, 13.0204],
      [47.59, 12.988],
    ],
  },
]

/** Four days across the Karwendel, hut to hut. */
const HUT_TOUR: Tour = {
  trip: 'Karwendel huts',
  days: [
    {
      title: 'Scharnitz – Karwendelhaus',
      sport: 'hike',
      profile: 'hiking',
      at: [
        [47.39, 11.266],
        [47.4273, 11.4216],
      ],
    },
    {
      title: 'Karwendelhaus – Falkenhütte',
      sport: 'hike',
      profile: 'hiking',
      at: [
        [47.4273, 11.4216],
        [47.3996, 11.4989],
      ],
    },
    {
      title: 'Falkenhütte – Lamsenjochhütte',
      sport: 'hike',
      profile: 'hiking',
      at: [
        [47.3996, 11.4989],
        [47.3801, 11.6036],
      ],
    },
    {
      title: 'Lamsenjochhütte – Vomp',
      sport: 'hike',
      profile: 'hiking',
      at: [
        [47.3801, 11.6036],
        [47.3423, 11.6833],
      ],
    },
  ],
}

/**
 * Three tours, one a summer, each day starting where the last one stopped.
 *
 * This is what makes `trip:` mean anything and what puts a real streak in the calendar
 * — and on the map it draws a line across a country rather than another dot near home.
 */
const TOURS: Tour[] = [
  {
    trip: 'Balkans',
    days: [
      {
        title: 'Ljubljana – Novo Mesto',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [46.057, 14.506],
          [45.803, 15.169],
        ],
      },
      {
        title: 'Novo Mesto – Zagreb',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [45.803, 15.169],
          [45.815, 15.982],
        ],
      },
      {
        title: 'Zagreb – Sisak',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [45.815, 15.982],
          [45.485, 16.377],
        ],
      },
      {
        title: 'Sisak – Banja Luka',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [45.485, 16.377],
          [45.11, 16.83],
          [44.772, 17.191],
        ],
      },
      {
        title: 'Banja Luka – Jajce',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [44.772, 17.191],
          [44.341, 17.271],
        ],
      },
      {
        title: 'Jajce – Sarajevo',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [44.341, 17.271],
          [44.226, 17.665],
          [44.201, 17.907],
          [43.856, 18.413],
        ],
      },
    ],
  },
  {
    trip: 'Baltic coast',
    days: [
      {
        title: 'Tallinn – Pärnu',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [59.437, 24.754],
          [58.999, 24.793],
          [58.385, 24.497],
        ],
      },
      {
        title: 'Pärnu – Salacgrīva',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [58.385, 24.497],
          [58.083, 24.488],
          [57.755, 24.357],
        ],
      },
      {
        title: 'Salacgrīva – Riga',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [57.755, 24.357],
          [57.263, 24.415],
          [56.949, 24.105],
        ],
      },
      {
        title: 'Riga – Jelgava',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [56.949, 24.105],
          [56.652, 23.727],
        ],
      },
      {
        title: 'Jelgava – Šiauliai',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [56.652, 23.727],
          [56.24, 23.612],
          [55.934, 23.313],
        ],
      },
    ],
  },
  {
    trip: 'The Loire',
    days: [
      {
        title: 'Orléans – Blois',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [47.902, 1.909],
          [47.586, 1.335],
        ],
      },
      {
        title: 'Blois – Tours',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [47.586, 1.335],
          [47.413, 0.983],
          [47.394, 0.684],
        ],
      },
      {
        title: 'Tours – Saumur',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [47.394, 0.684],
          [47.325, 0.405],
          [47.26, -0.077],
        ],
      },
      {
        title: 'Saumur – Angers',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [47.26, -0.077],
          [47.472, -0.554],
        ],
      },
      {
        title: 'Angers – Nantes',
        sport: 'bike',
        profile: 'trekking',
        at: [
          [47.472, -0.554],
          [47.367, -1.177],
          [47.218, -1.554],
        ],
      },
    ],
  },
]

/**
 * Everything that is not a tour: one route, one day, drawn out of the year's shape.
 *
 * `source` is the seam. Komoot holds the planned things — a hike drawn the evening
 * before driving to the trailhead — and Strava holds what a watch uploaded on the way
 * home, which is every run and every ride from the door. Filtering by source then cuts
 * the archive along something real, instead of thinning every group by the same third.
 *
 * `peak` is the month the year is busiest in and `strength` how much: hikes and rides
 * are a summer, runs are what carries January.
 */
const KINDS = [
  { routes: RUNS, source: 'strava', weekend: false, peak: 1, strength: 0.45, latest: true },
  { routes: RIDES, source: 'strava', weekend: true, peak: 7, strength: 0.85, latest: false },
  { routes: HIKES, source: 'komoot', weekend: true, peak: 7, strength: 0.85, latest: false },
] as const

// ---------------------------------------------------------------------------
// BRouter, cached
// ---------------------------------------------------------------------------

/**
 * Where the routed legs are kept.
 *
 * Outside the repository on purpose. `data/` is what `git clean -xdf` takes and what a
 * fresh worktree does not have, and re-fetching sixty routes from a volunteer's server
 * because you changed branches is not a cost this should impose. Keyed on the waypoints
 * and the profile, so editing a coordinate misses the cache without anyone having to
 * remember a flag.
 */
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'tracks-seed')

const router = new BRouterRouter()

/** The ends are breaks and everything between them shapes the line — so, one request. */
function waypointsOf(route: Route): Waypoint[] {
  return route.at.map(
    ([lat, lon], index): Waypoint => ({
      lat,
      lon,
      kind: index === 0 || index === route.at.length - 1 ? 'poi' : 'routing',
      name: null,
    }),
  )
}

function keyOf(route: Route): string {
  const shape = JSON.stringify([route.profile, route.at])
  return createHash('sha256').update(shape).digest('hex').slice(0, 16)
}

/** Between requests. `brouter.de` is one enthusiast's machine, and it says so when pushed. */
const PACE = 1_500

/** After a "Please, retry later!" — which is the server asking, so it is worth obeying. */
const BACKOFF = [5_000, 15_000, 45_000]

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * One routed track, from the cache or from the router.
 *
 * Two kinds of no, kept apart. *This cannot be routed* — a 400, which is what a search
 * too expensive for the public server also comes back as — is a fact about the
 * coordinates, and asking again will not change it. *Please, retry later* is a fact
 * about the server, so it is waited out, three times, for longer each time.
 *
 * Either way the failure is returned rather than thrown, because a cold run wants to
 * report every route it could not fetch at once: being told about the Karwendel, fixing
 * it, and then being told about the Wetterstein is three runs where one would do.
 */
async function fetchRoute(route: Route): Promise<RoutedLeg | string> {
  const file = join(CACHE, `${keyOf(route)}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as RoutedLeg

  for (let attempt = 0; ; attempt++) {
    await wait(PACE)

    let legs: Awaited<ReturnType<typeof router.route>>
    try {
      legs = await router.route(waypointsOf(route), route.profile)
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      const patience = BACKOFF[attempt]
      if (patience === undefined) return reason
      await wait(patience)
      continue
    }

    const leg = legs[0]
    if (!leg) return 'the router answered with no legs'
    if (!leg.ok) return leg.reason

    mkdirSync(CACHE, { recursive: true })
    writeFileSync(file, JSON.stringify(leg))
    return leg
  }
}

// ---------------------------------------------------------------------------
// From a routed line to a recording
// ---------------------------------------------------------------------------

/** Metres per degree of latitude, as `polyline.ts` uses it. Good enough to interpolate. */
const M_PER_DEG = 111_320

function metres(a: readonly number[], b: readonly number[]): number {
  const lat = (((a[1] ?? 0) + (b[1] ?? 0)) / 2) * (Math.PI / 180)
  const x = ((b[0] ?? 0) - (a[0] ?? 0)) * Math.cos(lat) * M_PER_DEG
  const y = ((b[1] ?? 0) - (a[1] ?? 0)) * M_PER_DEG
  return Math.hypot(x, y)
}

/**
 * How long it took.
 *
 * BRouter's `total-time` is the whole answer for a hike or a ride: the profile knows
 * what it is modelling, and 3-5 km/h in the mountains and 15-21 km/h on a tour is what
 * comes back. There is no running profile, though — a run is routed as a walk — and a
 * run timed as a walk would land in the same speed band as one, which is exactly the
 * thing this seed exists to stop lying about. So a run is the single place a pace is set
 * here, at a little under six minutes a kilometre.
 */
function movingTime(route: Route, leg: RoutedLeg): number {
  if (route.sport !== 'run') return Math.round(leg.durationS)
  return Math.round(leg.distanceM / between(2.8, 3.4))
}

/** Stopped time, as a share of moving time: a summit, a café, a level crossing. */
const STOPPED: Record<Sport, [number, number]> = {
  run: [0.0, 0.03],
  bike: [0.1, 0.2],
  hike: [0.2, 0.35],
}

/**
 * A routed line, walked along at one point a second.
 *
 * The router answers at OSM's resolution — a node every twenty or thirty metres, and
 * none at all down a straight — which is a *route*, not a *recording*. A recording is
 * what the app is built to hold: the simplifier exists to thin one, the detail panel
 * draws one, and the elevation profile is only smooth because there are thousands of
 * samples behind it. So the line is resampled at the cadence a watch writes at, which
 * also gives `times` something true to say.
 *
 * Speed is constant along the track, which is the one thing here a real recording would
 * not do. It costs nothing that shows: `speedMs` is a per-activity figure, so the
 * distribution the analytics draw is unaffected either way.
 */
function record(leg: RoutedLeg, durationS: number) {
  const cumulative = [0]
  for (let i = 1; i < leg.coordinates.length; i++) {
    cumulative.push(cumulative[i - 1]! + metres(leg.coordinates[i - 1]!, leg.coordinates[i]!))
  }
  const total = cumulative[cumulative.length - 1] ?? 0

  const track: Array<[number, number]> = []
  const altitudes: number[] = []
  const times: number[] = []

  let at = 1
  for (let second = 0; second <= durationS; second++) {
    const along = total * (second / durationS)
    while (at < cumulative.length - 1 && cumulative[at]! < along) at++

    const back = cumulative[at - 1]!
    const span = cumulative[at]! - back
    const into = span === 0 ? 0 : (along - back) / span
    const from = leg.coordinates[at - 1]!
    const to = leg.coordinates[at]!

    track.push([
      Number((from[1]! + (to[1]! - from[1]!) * into).toFixed(6)),
      Number((from[0]! + (to[0]! - from[0]!) * into).toFixed(6)),
    ])
    const low = leg.altitudeM[at - 1] ?? 0
    altitudes.push(Math.round(low + ((leg.altitudeM[at] ?? low) - low) * into))
    times.push(second)
  }

  return { track, altitudes, times }
}

// ---------------------------------------------------------------------------
// When it happened
// ---------------------------------------------------------------------------

const DAY = 86_400_000

const iso = (at: Date) => at.toISOString().slice(0, 10)

/**
 * Three years, ending a few days before today.
 *
 * Anchored rather than fixed, so the app opens on an archive that reaches the present:
 * *YTD* has something in it, the calendar's last column is this month, and the volume
 * trend ends where you would expect. What that costs is a narrower promise about
 * determinism — the same command on the same day gives the same map, rather than the
 * same command forever — and everything except the anchor is still seeded.
 */
const end = new Date(new Date().setUTCHours(0, 0, 0, 0) - 4 * DAY)
const start = new Date(end)
start.setUTCFullYear(end.getUTCFullYear() - 3)

/**
 * The fortnights nothing happens in.
 *
 * Two a year, which is illness, work, or a holiday somebody else planned. Without them
 * the calendar is an even speckle, and an even speckle is the tell that made the old
 * seed look generated from across the room.
 */
function restingDays(): Set<string> {
  const out = new Set<string>()
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    for (const half of [0, 1]) {
      const first = Date.UTC(
        year,
        half * 6 + Math.floor(between(0, 6)),
        1 + Math.floor(between(0, 14)),
      )
      for (let day = 0; day < 14; day++) out.add(iso(new Date(first + day * DAY)))
    }
  }
  return out
}

const resting = restingDays()
const taken = new Set<string>()

const free = (date: string) =>
  !taken.has(date) && !resting.has(date) && date >= iso(start) && date <= iso(end)

/** A year's shape, as one cosine. Hikes and rides peak in July; runs carry January. */
function season(at: Date, peakMonth: number, strength: number): number {
  const doy = (at.getTime() - Date.UTC(at.getUTCFullYear(), 0, 1)) / DAY
  return 1 + strength * Math.cos((2 * Math.PI * (doy - (peakMonth - 0.5) * 30.44)) / 365.25)
}

/** Consecutive free days, somewhere in the `spread` days after the first of a month. */
function block(year: number, month: number, spread: number, length: number): string[] {
  for (let attempt = 0; attempt < 400; attempt++) {
    const first = Date.UTC(year, month, 1 + Math.floor(between(0, spread)))
    const days = Array.from({ length }, (_, day) => iso(new Date(first + day * DAY)))
    if (days.every(free)) {
      for (const day of days) taken.add(day)
      return days
    }
  }
  throw new Error(`no room for ${length} days in ${year}-${month + 1}`)
}

/**
 * `n` days, drawn without replacement, weighted by the season.
 *
 * `latest` pins one of them to the most recent day that qualifies. Anchoring the window
 * to today buys nothing if the newest activity in it is five weeks old — the app would
 * open on a stale archive, which is the thing a fixed window was rejected for — so one
 * kind claims the end of the window before the weighting gets a say.
 */
function scatter(
  n: number,
  weekend: boolean,
  peak: number,
  strength: number,
  latest = false,
): string[] {
  const pool: Array<{ date: string; weight: number }> = []
  for (let at = start.getTime(); at <= end.getTime(); at += DAY) {
    const day = new Date(at)
    const date = iso(day)
    if (!free(date)) continue
    if (weekend !== (day.getUTCDay() === 0 || day.getUTCDay() === 6)) continue
    pool.push({ date, weight: season(day, peak, strength) })
  }

  const chosen: string[] = []
  if (latest && pool.length > 0) {
    const newest = pool.pop()!
    chosen.push(newest.date)
    taken.add(newest.date)
  }

  for (let i = chosen.length; i < n && pool.length > 0; i++) {
    let target = roll() * pool.reduce((sum, day) => sum + day.weight, 0)
    let at = 0
    while (at < pool.length - 1) {
      target -= pool[at]!.weight
      if (target <= 0) break
      at++
    }
    chosen.push(pool[at]!.date)
    taken.add(pool[at]!.date)
    pool.splice(at, 1)
  }

  // Silently placing fifty-one activities because the resting fortnights happened to
  // land on the weekends is the kind of thing nobody notices until a chart is wrong.
  if (chosen.length < n) throw new Error(`only ${chosen.length} of ${n} days were free`)
  return chosen
}

/**
 * The three most recent summers a tour fits inside.
 *
 * A window anchored to today holds three whole years but not three whole summers of
 * them — a run in March reaches back to a March, and the summer at each end is half
 * there. So the years are found rather than assumed, and a fourth summer at the start
 * of the window is simply never used.
 */
function summers(): number[] {
  const years: number[] = []
  for (
    let year = end.getUTCFullYear();
    years.length < 3 && year >= start.getUTCFullYear();
    year--
  ) {
    const opens = iso(new Date(Date.UTC(year, 5, 15)))
    const closes = iso(new Date(Date.UTC(year, 7, 20)))
    if (opens >= iso(start) && closes <= iso(end)) years.unshift(year)
  }
  if (years.length < 3) throw new Error('the window does not hold three summers')
  return years
}

/**
 * The UTC instant a local start time falls at.
 *
 * Through the same timezone dataset the server will use on the row, so an evening run is
 * an evening run in January and in July rather than drifting an hour with the clocks.
 */
function startedAt(date: string, hour: number, at: [number, number]): string {
  const minutes = Math.round(hour * 60)
  const naive = new Date(
    `${date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00.000Z`,
  )
  return new Date(naive.getTime() - utcOffsetAt(at[0], at[1], naive) * 1000).toISOString()
}

/** Local start times, as decimal hours. Runs after work, everything else after breakfast. */
const HOUR: Record<Sport, [number, number]> = {
  run: [17.5, 19.0],
  bike: [8.0, 10.0],
  hike: [7.5, 9.0],
}

// ---------------------------------------------------------------------------
// Building the archive
// ---------------------------------------------------------------------------

interface Planned {
  route: Route
  date: string
  source: string
  trip: string | null
}

const plan: Planned[] = []

/** A tour's days, laid consecutively into one summer, under one `trip:`. */
function lay(tour: Tour, year: number, month: number, spread: number) {
  for (const [day, date] of block(year, month, spread, tour.days.length).entries()) {
    plan.push({ route: tour.days[day]!, date, source: 'komoot', trip: `${tour.trip} ${year}` })
  }
}

// The blocks go first, because they claim consecutive days and everything else has to
// fill in around them. One tour a summer, and the hut tour in a September.
const summer = summers()
for (const [index, tour] of TOURS.entries()) lay(tour, summer[index]!, 5, 62)
lay(HUT_TOUR, summer[1]!, 8, 18)

for (const kind of KINDS) {
  const dates = scatter(kind.routes.length, kind.weekend, kind.peak, kind.strength, kind.latest)
  for (const [index, date] of dates.entries()) {
    plan.push({ route: kind.routes[index]!, date, source: kind.source, trip: null })
  }
}

plan.sort((a, b) => a.date.localeCompare(b.date))

/** A title, as something that survives being a primary key. */
function slug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function frame(planned: Planned, leg: RoutedLeg): ImportFrame {
  const { route } = planned
  const durationS = movingTime(route, leg)
  const { track, altitudes, times } = record(leg, durationS)
  const [low, high] = STOPPED[route.sport]
  const [fromHour, toHour] = HOUR[route.sport]

  return {
    source: planned.source,
    externalId: slug(route.title),
    title: route.title,
    startedAt: startedAt(planned.date, between(fromHour, toHour), route.at[0]!),
    distanceM: Math.round(leg.distanceM),
    durationS,
    elapsedS: Math.round(durationS * (1 + between(low, high))),
    elevationGainM: Math.round(leg.ascentM),
    tags: [`sport:${route.sport}`],
    geometry: polyline.encode(track, IMPORT_PRECISION),
    altitudes,
    times,
  }
}

// ---------------------------------------------------------------------------
// Writing it down
// ---------------------------------------------------------------------------

console.log(`${plan.length} routes, cached in ${CACHE}`)

const routed: Array<{ planned: Planned; leg: RoutedLeg }> = []
const failed: Array<{ title: string; reason: string }> = []

for (const [index, planned] of plan.entries()) {
  const leg = await fetchRoute(planned.route)
  if (typeof leg === 'string') failed.push({ title: planned.route.title, reason: leg })
  else routed.push({ planned, leg })
  process.stdout.write(`\r  routing  ${index + 1} of ${plan.length}`)
}
process.stdout.write('\r'.padEnd(30))

// Nothing is written when anything is missing. A database that is quietly forty-three
// activities because a volunteer's server was busy is worse than no database at all —
// the count is what half the screens are counting. Whatever did arrive stayed in the
// cache, so running again asks only for the rest.
if (failed.length > 0) {
  console.error(`\n${failed.length} of ${plan.length} routes could not be fetched:\n`)
  for (const { title, reason } of failed) console.error(`  ${title}\n    ${reason}`)
  console.error('\nNothing was written. Fix the coordinates, or try again later.')
  process.exit(1)
}

const path = resolve(import.meta.dirname, '../../data/dev.db')
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(path + suffix)) rmSync(path + suffix)
}

const { db, close } = await openDb(`file:${path}`, resolve(import.meta.dirname, '../../migrations'))

// Migration 0004 seeds one passwordless account, and everything here lands on it. It
// stays passwordless: `pnpm dev:local` is what claims it, on the way to signing itself
// in, so the sign-in form is not part of development unless you ask for it.
const [user] = await db.all<{ id: number; email: string }>(sql`SELECT id, email FROM users`)
const owner = { userId: user!.id }

let points = 0
for (const [index, { planned, leg }] of routed.entries()) {
  const built = frame(planned, leg)
  await ingestActivity(db, owner, built)
  points += built.times?.length ?? 0

  // The trip goes on through the same route the detail panel uses, so the registry ends
  // up holding a type it was told about rather than one seeded here.
  if (planned.trip) {
    const [row] = await db.all<{ id: number }>(
      sql`SELECT id FROM activities WHERE external_id = ${built.externalId}`,
    )
    await writeActivityTags(db, owner, row!.id, {
      tags: [...built.tags, `source:${built.source}`, `trip:${planned.trip}`],
      newType: { name: 'trip', label: 'Trip', singleValued: true },
    })
  }

  process.stdout.write(`\r  writing  ${index + 1} of ${routed.length}`)
}

const km = routed.reduce((sum, { leg }) => sum + leg.distanceM, 0) / 1000
console.log(
  `\n\ndata/dev.db: ${routed.length} activities, ${points.toLocaleString('en')} points, ${Math.round(km).toLocaleString('en')} km for ${user!.email}`,
)
console.log(`${iso(start)} to ${iso(end)}, ending four days before today`)
console.log('`pnpm dev:local` signs in as that account by itself — password: password')
console.log('\n  pnpm dev:local')
close()
