# Tracks — Design Brief

One map for everything you've ridden and walked — pulled from Strava and Komoot,
tagged, filtered and counted on your own machine.

| | |
|---|---|
| **Deployment** | Local-only, single user |
| **Dataset** | ~500 activities, ~1–3M trackpoints |
| **Stack** | Node 24 · pnpm · SQLite |
| **Status** | Design settled, M1 not started |

---

## Scope

One command starts a local server; you open it in a browser. Nothing is hosted, nobody
signs in, no data leaves the machine except tile requests. The tool imports activities
from Strava and Komoot, draws them on a map, lets you tag and filter them, and counts them.

### Non-goals

| | |
|---|---|
| **Segment & route matching** | "Have I ridden this climb before, was I faster?" needs map-matching and track-similarity work. A separate project, and Strava already does it. |
| **Performance analysis** | No heart rate, power, cadence, zones or fitness modelling. Out by construction — only GPS, elevation and time are stored. |
| **Writing back upstream** | Strictly read-only sync. No pushing tags, renames or edits to Strava or Komoot. Keeps the blast radius of any bug at zero. |
| **Photos and media** | Both services attach photos. Not imported, not displayed. |

Route planning is wanted *eventually*, but nothing is reserved for it — adding a nullable
column later is the safest migration there is.

### Conventions

Metric throughout (km, m, km/h). ISO dates. Weeks start Monday.

---

## Ingestion & sync

| Source | Access | Risk |
|---|---|---|
| Strava | Official OAuth2 API, scope `activity:read_all` | Documented and stable |
| Komoot | Undocumented `api.komoot.de` v007, email + password | Can break without notice |

Both sit behind a single `ActivitySource` interface, with recorded HTTP responses as
fixtures — so a Komoot schema change surfaces as a specific failing test rather than a
mystery. Only **recorded** Komoot tours are imported; planned routes are excluded.

### Why there is no cursor table

The activity *list* costs almost nothing — 200 per page means all 500 activities in three
requests. The *streams* (trackpoints) cost one request each, and Strava allows 100 read
requests per 15 minutes, 1,000 per day. Re-pulling 500 streams would take 75 minutes and
half the daily budget.

So the sync always pulls the full list and upserts metadata, then fetches streams only for
activities that have no trackpoints yet:

```sql
-- what still needs streams
SELECT a.id FROM activities a
LEFT JOIN trackpoints t ON t.activity_id = a.id
WHERE t.activity_id IS NULL;
```

Resumability stops being a feature and becomes emergent: a sync that dies at activity 200
leaves 300 rows unfilled, and the next run picks them up. There is no cursor to corrupt and
no `after=` gap to silently skip a range. Upstream edits propagate automatically, because
every activity's metadata is re-read on every run.

### The first backfill

Fetching streams for ~500 activities costs ~75 minutes of wall clock against the rate limit.
That is a genuine one-time cost — trackpoints never change, so each activity's streams are
fetched exactly once, ever. It runs unattended.

Nothing is blocked while it happens. The list response includes Strava's own
`map.summary_polyline`, so **the map is fully populated within seconds** at summary
resolution, and detailed tracks sharpen as streams arrive behind it.

| | |
|---|---|
| **Duplicates across services** | Not merged. The two accounts cover different activities; a `source` column lets you split when it matters. |
| **Upsert key** | `(source, external_id)`. Re-sync refreshes upstream metadata and never touches your tags. |
| **Deletions** | Not tracked. Local rows persist. (Now cheap to add if wanted, since the full upstream list is in hand every run.) |
| **Trigger** | Manual. No scheduler, no background daemon. |
| **Raw payloads** | Archived to `data/raw/<source>/<id>/`. Not the source of truth — an archive to backfill from when the schema or a derivation changes. |

---

## Secrets & auth

| Secret | Where | Why |
|---|---|---|
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | proton-env | Long-lived identity. Never changes, never written. |
| `KOMOOT_EMAIL`, `KOMOOT_PASSWORD` | proton-env | Same. Session held in memory per run. |
| Strava refresh token | `data/token.json` — gitignored, chmod 600 | Machine-generated state the app must be able to *rewrite*. |

Everything the tool produces lives under `data/`: the token, the raw payload archive and
`tracks.db`. One directory to back up, one to wipe.

> `data/` is gitignored, which means `git clean -xdf` deletes all of it — including the only
> copy of your tags. The token is the cheapest thing in there to lose.

Strava access tokens expire after six hours, and the refresh token *rotates* — their docs
are explicit that the old one stops working the moment a new one is issued. A rotating value
cannot live in a read-only injection tool: it would go stale silently and surface as a broken
sync plus a manual re-paste. On disk, the app writes the new token back in place and rotation
becomes a non-event.

> Consent is genuinely one-time. `approval_prompt` defaults to `auto`, so a previously
> authorized app skips the prompt entirely — a re-auth is a browser tab that bounces straight
> back with no click. `localhost` and `127.0.0.1` are whitelisted redirect targets.

---

## Data model

SQLite, not DuckDB — at 500 activities and a few million trackpoints, a columnar engine buys
nothing and costs a second writer-hostile store. The schema started at six tables and every
cut below was justified by something being derivable, archived, or speculative.

```sql
activities (
  id           INTEGER PRIMARY KEY,
  source       TEXT NOT NULL,               -- 'strava' | 'komoot'
  external_id  TEXT NOT NULL,
  title        TEXT,
  started_at   TEXT NOT NULL,               -- UTC, ISO8601
  utc_offset   INTEGER NOT NULL,            -- seconds
  distance_m       REAL,                    -- service-reported
  duration_s       INTEGER,                 -- service-reported
  elevation_gain_m REAL,                    -- service-reported
  polyline     TEXT,                        -- simplified, encoded
  tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array
  UNIQUE (source, external_id)
);

trackpoints (
  activity_id  INTEGER NOT NULL REFERENCES activities(id),
  seq          INTEGER NOT NULL,            -- authoritative ordering
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  altitude_m   REAL,                        -- height above sea level
  recorded_at  INTEGER,                     -- Unix epoch seconds, UTC
  PRIMARY KEY (activity_id, seq)
);

CREATE INDEX trackpoints_spatial ON trackpoints (lat, lon, activity_id);
```

### Tags

A flat JSON array on the activity, queried with `json_each()`. No join table, no tag ids.
Sport is **auto-derived on import** into that same array, which makes the canonical sport
vocabulary — `ride`, `mtb`, `gravel`, `run`, `hike` … — *reserved*: the UI must refuse a
manual tag with one of those names, or a re-derive will quietly eat it. That is the entire
cost of the flat model.

```sql
SELECT a.* FROM activities a, json_each(a.tags) t
WHERE t.value = 'alps';
```

### Time

UTC instant plus offset. The local date is `date(started_at, utc_offset || ' seconds')`,
computed inline — storing it would be denormalization that can drift, and no `GROUP BY` over
500 rows needs an index. Analytics bucket on the local date, so a late-night ride at home and
a morning ride abroad both land on the day you actually rode.

### The spatial index

Duplicate coordinates across activities are the point, not a problem — two activities crossing
the same spot should both match, and `SELECT DISTINCT activity_id` handles it. The index is
`(lat, lon, activity_id)` rather than `(lat, lon)` because SQLite can only seek on the first
column's range; making it covering means the query is answered from the index alone, with no
table lookups.

---

## Map

[VersaTiles](https://versatiles.org/) serves OpenStreetMap-derived vector tiles with no API
key, no usage fees and no user tracking, on the CC-0 Shortbread schema. Global elevation data
shipped in April 2026, so hillshading works — the one thing it lacked for outdoor use. Contour
lines are still unimplemented; that is the only gap against a commercial outdoor style. The
basemap is a config value, so swapping providers or dropping to a locally-served container is
a one-line change.

| | |
|---|---|
| **What gets drawn** | A precomputed Douglas–Peucker polyline per activity at ~10 m tolerance. All 500 ship as a single GeoJSON of a few megabytes; full-resolution points load only when you open one activity. |
| **Colour** | By sport as default, switchable to tag, recency or year. Turns the map into an instrument rather than a tangle of identical lines. |
| **Hover linking** | Two-way. Hover a list row and its track highlights while the rest dim; hover a track and the list scrolls to it. |
| **Viewport** | Auto-fits to the active filter, with a lock toggle for when you're studying one area. |
| **Low zoom** | Clustered start-point markers, for seeing where rides actually begin. |

### Spatial filtering is exact

Because trackpoints are rows, drawing a box on the map is a direct query — no bounding-box
column, no client-side refinement pass, no approximation:

```sql
SELECT DISTINCT activity_id FROM trackpoints
WHERE lat BETWEEN ?min_lat AND ?max_lat
  AND lon BETWEEN ?min_lon AND ?max_lon;
```

Tens of milliseconds over ~3M rows on the covering index. The only theoretical gap — a track
crossing the box with no sampled point inside it — is irrelevant at one-second sampling.

---

## Filters & UI

The map fills the window. A collapsible sidebar carries the filters; the activity list stays
synced beside it. Filter state lives in the URL, so any view is bookmarkable.

| Group | Facets |
|---|---|
| Core | Date range · sport · tags (include / exclude, AND / OR) · source · spatial box |
| Ranges | Distance, elevation, duration, average speed — dual-handle sliders over histogram backgrounds, so the distribution is visible while you drag |
| Text | Free-text match on title and description |
| Presets | This year · last 30 days · **untagged** |

> **The discipline that holds this together:** one filter serialization, defined once in
> `packages/core` and imported by both the server and the browser. Every endpoint parses
> filters with the same code, so "the current filter" means precisely the same thing on the
> map, in the list and in the charts. This is the single biggest reason the stack is one
> language.

### API surface

| Route | Returns |
|---|---|
| `GET /api/activities?<filters>` | List rows plus simplified polylines |
| `GET /api/activities/:id` | Detail plus full trackpoints |
| `GET /api/stats?<filters>` | Aggregates for the analytics views |
| `GET /api/heatmap?<filters>` | Grid cell counts — **deferred** |
| `POST` / `DELETE /api/activities/:id/tags` | Tag mutations |

---

## Analytics

Analytics recomputes over whatever the filter currently selects — so "gravel rides in the Alps
in 2024" is one filter away from a full breakdown. No compare-to-previous-period selector.

- **Volume trends** — distance, elevation, moving time and count by week, month or year, split by sport or tag.
- **Calendar heatmap** — a year grid coloured by distance or duration, for spotting consistency and gaps.
- **Distributions and records** — histograms of distance, elevation, duration and speed, plus longest, highest, fastest and longest streak.
- **Elevation profile** — per activity, with the cursor linked to a marker on the map.

**ECharts**, reversing an earlier preference for Observable Plot. Two of the four cases hit
ECharts built-ins directly — it has a purpose-built calendar coordinate system, and
`dispatchAction` makes the two-way chart↔map cursor sync trivial. Plot's main advantage, its
statistical transforms, is neutralised because aggregation happens in SQL anyway.

Only service-reported metrics are stored. Anything else — consistent cross-service numbers, or
metrics for part of a track — is computed from trackpoints on demand, since the dynamic path
has to exist for segments regardless. A cache table can follow later, if a chart proves slow
enough to justify one.

---

## Stack

```
tracks/
├─ packages/core     # schema, types, THE filter serialization
├─ packages/server   # Hono REST API · CLI · ActivitySources
├─ packages/web      # React · MapLibre · ECharts
├─ migrations/       # drizzle-kit
├─ fixtures/         # recorded Strava & Komoot responses
└─ data/             # gitignored: token.json, raw JSON, tracks.db
```

| | |
|---|---|
| **Language** | TypeScript end to end. Every heavy-geo case that would have justified Python — FIT parsing, segment matching, performance analysis — is an explicit non-goal, and a shared filter package is worth more than a stronger geo ecosystem. |
| **Driver** | `better-sqlite3`. Required by drizzle-kit, which does not support `node:sqlite`, and hardened besides. |
| **Query layer** | Drizzle for schema, migrations and CRUD; hand-written SQL for spatial queries and aggregations, where query builders are worse than the SQL they generate. |
| **Not Deno** | Better DX and a genuinely useful permissions model, but drizzle-kit + `node:sqlite` is an open bug needing a community patch — a patched migration toolchain is the wrong place to spend novelty. |
| **Testing** | Vitest with msw serving recorded fixtures. The whole suite runs offline in seconds. |
| **CLI** | `tracks sync` and `tracks serve`. Nothing else — tagging belongs in the UI. |

---

## Milestones

Strava leads because it is documented: the schema and sync loop get debugged against a stable
API before the undocumented one is attempted. Until M3 there is no UI, so M1 and M2 are
inspected through a SQLite browser.

| | | |
|---|---|---|
| **M1** | Strava → SQLite | Schema, migrations, the `ActivitySource` interface, Strava OAuth, `tracks sync`, recorded fixtures. |
| **M2** | Komoot | Second source behind the same interface, with its own fixtures. Validates that the schema fits both shapes. |
| **M3** | Map, list and filters | `tracks serve`: REST API, MapLibre map, synced activity list, the full filter sidebar including spatial selection. |
| **M4** | Tagging | Tag UI and tag-driven filtering, including whatever makes 500 untagged activities tractable. |
| **M5** | Analytics | The four ECharts views, scoped to the active filter. |
| **M6** | Heatmap and coverage | "Everywhere I've been", percentage of terrain covered, new-versus-repeated per activity. |

---

## Considered and rejected

Recorded because the reasoning is worth more than the conclusion — and because a future reader
will otherwise propose all of these again.

| Rejected | Why |
|---|---|
| DuckDB | Columnar storage earns nothing at 3M rows, and it is single-writer — hostile to interactive tagging. |
| Strava bulk archive for backfill | It exists (Settings → Download or Delete Your Account → Request Your Archive) but Strava takes hours to 10 days to prepare it — *slower* than the 75-minute unattended API backfill. Archive files are a mix of GPX, FIT and TCX, so it would also mean three parsers and a second permanent ingestion path for a one-time job. Komoot has no bulk export at all. |
| Deno 2 | drizzle-kit has an open bug with `node:sqlite`; the workaround is a third-party patch on core tooling. |
| H3 cell precompute | Deferred with the heatmap. The trackpoint table supports it and every alternative. |
| bbox column + turf refine | Trackpoint rows make the bounding-box query exact and index-covered. Superseded. |
| `sport_raw` | Already in the on-disk raw JSON. Duplicating the archive into the DB for a query nobody runs. |
| `local_date` | Derivable from `started_at` + `utc_offset`. Denormalization that can drift, for an index nothing needs. |
| `deleted_upstream` | Undetectable with an incremental sync anyway — a deleted activity is indistinguishable from an unlisted one. |
| `kind` discriminator | Reserved space for planned routes that have no design. Adding a nullable column later is trivial. |
| Self-computed metrics | Segment metrics must be dynamic regardless, so storing whole-activity copies duplicates code that already exists. |
| `sync_runs` / `sync_state` | The full-list-plus-missing-streams strategy makes the database its own sync state. |
| Tags join table | A JSON array with `json_each()` does the job at this size. A tags table only earns its keep once tags need metadata. |
| `tags_auto` / `tags_manual` | Traded for a reserved sport vocabulary. Simpler schema, one convention to honour in the UI. |
| Cross-service dedup | The two accounts cover different activities. Merge logic would be risk without benefit. |
| Tag export / backup | Accepted risk, deliberately. Tags are the only non-regenerable data in the system. |
| Observable Plot | More elegant, but the calendar heatmap and map-linked cursor would both be hand-rolled. |
| MapTiler · OSM raster | MapTiler costs a key and a quota for contour lines alone; raster OSM has no hillshading and a usage policy this would strain. |

---

## Still undecided

**Heatmap implementation** *(M6)* — Two live candidates. An on-the-fly SQL grid —
`GROUP BY round(lat,4), round(lon,4)` — needs no dependency, no precompute, and respects the
active filter for free. Precomputed H3 cells give equal-area hexagons and instant
set-difference queries for "was this new terrain?", at the cost of an import step that is
filter-blind. Nothing in the schema forecloses either.

**Tag UX** *(M4)* — Deferred until the UI exists. The open question is how 500 untagged
activities get worked through — bulk-applying a tag to everything matching the current filter
is the obvious lever, paired with the *untagged* preset.

**REST surface detail** *(M3)* — Routes are sketched; payload shapes, pagination for the list,
and the tag mutation contract are not.
