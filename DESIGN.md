# Tracks — Design Brief

One map for everything you've ridden and walked — pulled from Strava and Komoot,
tagged, filtered and counted on your own machine.

| | |
|---|---|
| **Deployment** | Local-only, single user |
| **Dataset** | 197 activities (73 Strava, 124 Komoot), 1.02M trackpoints |
| **Stack** | Node 24 · pnpm · SQLite · React · MapLibre |
| **Status** | M1–M2.5 complete; M3 (map, list, filters) in progress |

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
| Strava | **Bulk archive import** — GPX/TCX files + `activities.csv` | None; a manual, offline file drop |
| Komoot | Undocumented `api.komoot.de` v006/v007, email + password | Can break without notice |

Komoot notes, all confirmed against the live API: login returns a **session token**,
not the password, and that token authenticates everything afterwards. Sending
`Accept: application/json` earns a **406** — the API serves HAL, and sending no
Accept header is what works. Coordinates arrive as `{lat, lng, alt, t}` where `t`
is **milliseconds since the tour started**. Tours carry both `duration` (elapsed)
and `time_in_motion` (moving), which maps onto `elapsed_s` and `duration_s`
exactly. The `date` field is UTC (`...Z`) despite its format permitting an offset,
so the offset is derived from coordinates here too.

### Why not the Strava API

Since June 2026 Strava requires a paid subscription for Standard Tier developer API
access — which is what a personal single-user app is. Extended Access (exempt) needs
10,000+ users and Strava's approval. The same announcement states that *"every Strava
athlete can still access and download their data for free, at any time"*, so the bulk
archive is the free route and the one this tool uses.

Consequence: **Komoot's undocumented API is the only live integration.** Strava data
refreshes only when you request a new archive and import it.

Both sit behind a single `ActivitySource` interface, with recorded HTTP responses as
fixtures — so a Komoot schema change surfaces as a specific failing test rather than a
mystery. Only **recorded** Komoot tours are imported; planned routes are excluded.

### Why there is no cursor table

Re-importing is idempotent. Every run reads the whole archive (or the whole Komoot tour
list) and upserts by `(source, external_id)`; an activity that already has trackpoints is
not re-parsed. The database is its own sync state — there is no cursor to corrupt and no
`after=` gap that could silently skip a range.

Resumability is emergent rather than engineered: a run that dies partway leaves rows
unfilled, and the next run fills them.

### What the archive actually contains

Measured against a real export (78 activities, 4.3 years):

| | |
|---|---|
| Formats | 57 `.gpx`, 14 `.tcx.gz`, 2 `.gpx.gz` — **no FIT files** |
| Trackpoints | 286,327 total; median 4,098 per activity, max 25,029 |
| Trackless | 5 pool swims have no file at all — **not imported** |
| CSV | 103 columns, headers localized to the account language, **duplicate names** |

Four traps the importer must handle, each found in the real data:

1. **The filename is not the activity id.** `4008673018.gpx.gz` belongs to activity
   `3752382383`. The CSV's `Dateiname` column is the only link, which makes the CSV
   mandatory rather than optional.
2. **TCX files begin with whitespace before `<?xml`**, which is strictly malformed; most
   XML parsers reject the prolog outright unless the input is trimmed first.
3. **Duplicate CSV header names** (`Distanz` at 7 and 18, `Verstrichene Zeit` at 6 and 16)
   mean columns must be read by position, never by name.
4. **Third-party uploads carry no `<type>`.** Both Garmin-uploaded rides lack it, so those
   two get no automatic sport tag and are tagged by hand.

The CSV has a machine-formatted block — columns 15, 16, 17 and 20 — in SI units with dot
decimals, so no German number parsing is needed. Only the header names are localized.

| Column | Header | Maps to |
|---|---|---|
| 15 | `Verstrichene Zeit` | `elapsed_s` |
| 16 | `Bewegungszeit` | `duration_s` (moving time) |
| 17 | `Distanz` | `distance_m` |
| 20 | `Höhenzunahme` | `elevation_gain_m` |

### Derived at import

**Timezone.** Nothing in the archive records a UTC offset — the CSV date is UTC and matches
the GPX `Z` timestamp exactly. So the offset is derived from the track itself: the first
trackpoint's coordinates give an IANA zone via `tz-lookup`, and the zone plus the activity's
date gives the offset with DST handled. Independent of file format, and it works for Komoot
too.

**Sport.** Taken from the file — GPX `<type>`, TCX `Sport` — which is English and
locale-independent. There is no CSV fallback: an activity whose file carries no type gets no
automatic sport tag and is tagged manually. Each source maps its own vocabulary to a `sport:`
tag itself rather than handing a raw string to the pipeline, so Komoot's `touringbicycle` and
Strava's `cycling` are two facts about two services that are free to drift apart. A string
neither source's map recognises derives nothing at all. Accordingly, **re-derivation only acts
when the source supplies a type**; where it does not, existing tags are left untouched, so a
manual sport tag survives every future import.

**Title.** The file's own name, falling back to the CSV title. This preserves original names
from third-party uploads — *"Almenrunde"* rather than Strava's auto-generated *"Fahrt am
Morgen"*.

### Sync rules

| | |
|---|---|
| **Duplicates across services** | Not merged. The two accounts cover different activities; a `source` column lets you split when it matters. |
| **Upsert key** | `(source, external_id)`. Re-sync refreshes upstream metadata and never touches your tags. |
| **Deletions** | Not tracked. Local rows persist. |
| **Trigger** | Manual. No scheduler, no background daemon. |
| **Raw payloads** | Archived to `data/raw/<source>/<id>/` only by sources that cannot cheaply be re-read — Komoot. The Strava export is already a durable copy on disk, so re-deriving means re-running the import against it rather than storing a second copy. |

---

## Secrets & auth

Strava needs no credentials at all — the archive is a file you already have. Only Komoot
requires secrets, and they are never written anywhere.

| Secret | Where | Why |
|---|---|---|
| `KOMOOT_EMAIL`, `KOMOOT_PASSWORD` | proton-env | Injected at run time; the session is held in memory and discarded. |

There is no OAuth flow, no token file and no token rotation to handle. Everything the tool
*produces* lives under `data/`: the raw payload archive and `tracks.db`. One directory to
back up, one to wipe.

> `data/` is gitignored, which means `git clean -xdf` deletes all of it — including the only
> copy of your tags.

---

## Data model

SQLite, not DuckDB — at this scale (~1M trackpoints) a columnar engine buys nothing and
costs a second writer-hostile store. The schema started at six tables and every
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
  duration_s       INTEGER,                 -- service-reported, moving time
  elapsed_s        INTEGER,                 -- service-reported, wall clock
  elevation_gain_m REAL,                    -- service-reported
  polyline     TEXT,                        -- simplified, encoded
  tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array of '<type>:<value>'
  min_lat      REAL,                        -- the track's bounding box, cached
  max_lat      REAL,
  min_lon      REAL,
  max_lon      REAL,
  UNIQUE (source, external_id)
);

tag_types (
  name          TEXT PRIMARY KEY,           -- 'sport', 'trip', 'source'
  label         TEXT NOT NULL,              -- 'Sport'
  enum_values   TEXT,                       -- JSON array, or NULL = free string
  single_valued INTEGER NOT NULL,           -- one radio, or many checkboxes
  color         TEXT NOT NULL,              -- per type, not per value
  sort          INTEGER NOT NULL UNIQUE     -- sidebar order
);

trackpoints (
  activity_id  INTEGER NOT NULL REFERENCES activities(id),
  seq          INTEGER NOT NULL,            -- authoritative ordering
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  altitude_m   REAL,                        -- height above sea level
  recorded_at  INTEGER,                     -- Unix epoch seconds, UTC
  PRIMARY KEY (activity_id, seq)
) WITHOUT ROWID;
```

`WITHOUT ROWID` because the primary key *is* how a track is read — `WHERE activity_id = ?
ORDER BY seq` walks the table itself. On a rowid table that key would be a second copy of
itself: a 15.7MB unique index sitting beside a hidden rowid nothing refers to.

There is no index on `lat`/`lon`. One existed and cost 35MB — better than a third of the
database — to range-scan a latitude band and then test longitude row by row, because a B-tree
orders on one dimension and the second half of its key pruned nothing. The four bounding-box
columns on `activities` replace it with 6KB, and answer the same question faster.

### Tags

Every tag is `<type>:<value>` — `sport:hike`, `trip:Balkan 2026`, `source:komoot`. The
assignment stays a flat JSON array on the activity, queried with `json_each()`. What the
schema gains is a registry of the *types*, because a type carries what a bare string cannot:
which values it permits, whether an activity may hold more than one, and how the sidebar
draws it.

| Seeded type | Values | Single | Written by |
|---|---|---|---|
| `sport` | enum: `bike`, `hike`, `run` | yes | import |
| `trip` | free string | yes | you |
| `source` | free string | yes | import |

Splitting on the **first** colon makes the type an identifier (`/^[a-z][a-z0-9_]*$/`) and
leaves the value free — `trip:Balkan 2026` keeps its capitals and its space, so nothing has
to un-mangle it for display. Values compare exactly; autocomplete over existing values is
what stops `balkan 2026` becoming a second trip. Arrays are sorted on write, so a re-import
that changes nothing produces a byte-identical row.

```sql
SELECT a.* FROM activities a, json_each(a.tags) t
WHERE t.value = 'trip:Balkan 2026';
```

**A registry instead of a reserved word list.** The flat model's one cost used to be that
sport names were reserved: the UI had to refuse a manual `hike` tag, or a re-derive would
quietly eat it. The type prefix removes the collision rather than policing it — the importer
owns `sport:` and `source:`, you own everything else, and no name is forbidden anywhere.
What replaces `isReservedTag` is one merge rule: **for each `(type, value)` a source derives,
drop that type's existing tags and add the new one.** A type the source says nothing about is
untouched, which is exactly the property that keeps a hand-tagged Garmin upload hand-tagged.

**Types only — still no tag ids.** The registry holds types, never values, so `trip:Balkan
2026` remains a string in an array: tagging is one `UPDATE`, and there is nothing to garbage
collect when the last activity loses a trip. The price is that renaming a trip rewrites every
array mentioning it — a 500-row update measured in milliseconds, against a join table that
would have to exist all the time.

**`source:` duplicates `activities.source` on purpose.** The column cannot go: the upsert key
`(source, external_id)` needs it, and it decides which importer owns a row and which raw
directory it lands in. The tag is a derived copy, written in the same transaction, bought
deliberately so that every facet in the sidebar is the same kind of thing.

**Enforcement is in code, not in SQLite.** `validateTag(registry, tag)` lives in
`packages/core` beside the filter serialization — the same discipline the filters already
depend on. The server validates on write, the browser validates before submitting, and both
run the identical function. The JSON array itself carries no constraints, and the registry is
read per request rather than cached, so a hand-edit in a SQLite browser takes effect without
a restart.

**The registry is authoritative, so it cascades.** Deleting a type, or removing a value from
an enum, strips those tags from every activity in the same transaction; no tag outlives its
type. The one flow that runs the other way is the importer: a derived value the enum no
longer contains is **re-added** to the registry, and the run reports it. A source's
vocabulary is a fact, the registry is a preference — so deleting `run` only sticks until you
go for a run.

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
key, no usage fees and no user tracking, on the CC-0 Shortbread schema. The style is
`@versatiles/style`'s `colorful`, pulled back by a `recolor` pass — desaturated a third and washed
towards the paper the app is drawn on. It began as `graybeard`, on the principle that the tracks
should own the only colour on screen; that turned out to read as a wireframe rather than as a map
of anywhere. Muted colour keeps water reading as water and woodland as woodland while still losing
to a saturated line drawn on top, which is the property the grey was really protecting. It lives
in one `basemap.ts` module, which is what keeps swapping providers or dropping to a locally-served
container a one-line change.

Global elevation shipped in April 2026 as a `raster-dem` tileset — terrarium encoding, 512 px,
z0–12 — and it closes both gaps that kept VersaTiles from being an outdoor basemap. Hillshading
is a first-class option of the style builder rather than a layer to assemble: passing `hillshade`
returns a style with the elevation source wired in, and its shadow, highlight and exaggeration are
tuned here to sit under the track colours rather than compete with them. Contours come from
`maplibre-contour`, which generates contour vector tiles from the same DEM in a worker: always on
above z11, with no toggle, because a contour is a property of the basemap and this app has no
map-options surface for one control to live in.

| | |
|---|---|
| **What gets drawn** | A precomputed Douglas–Peucker polyline per activity at ~10 m tolerance, served still encoded by `/api/tracks` and decoded in the browser. All 197 measure 214 KB stored and 0.23 MB on the wire, against 1.14 MB decoded; full-resolution points load only when you open one activity. |
| **Colour** | A *colour by* selector over the values of any registered type, or year — never over types themselves, since a type has one colour and colouring by it would draw every ride, hike and run identically. There is no *nothing*: a single-colour map answers no question the list does not answer better, so the default is the registry's first type. The registry's own `color` is for chips and sidebar group headers, not for tracks. |
| **Hover linking** | Two-way. Hover a list row and its track highlights; hover a track and the list scrolls to it. The rest keep their colour and weight. |
| **Viewport** | Eases to the result bounds once the filter settles — debounced, so dragging a slider fits at the end rather than every frame. It holds still when nothing matches, rather than lurching at empty bounds, and stays put entirely while *filter to this area* is on. |
| **Low zoom** | Start points cluster into **donuts**, split by the same colour-by that paints the tracks — which valley is all hiking and which is half rides, before you zoom in to find out. The client derives the start points from the track payload it already holds, so clustering costs no endpoint. A toggle turns grouping off entirely, and the tracks then never fade: the zoom interpolation existed only to make room for the donuts. |

### Colour is hashed, then unjammed

A colour has to belong to a value for as long as the value exists, with nothing stored
and no registry edit needed to make a new trip visible. A hash of `type:value` into a
categorical palette does all of that, and it is what the first cut shipped.

It collided on the first data it met. `sport:bike` and `sport:hike` both landed on slot
four, and a map that cannot tell a ride from a walk has failed at the one comparison it
exists for. With three values in ten slots the odds of *some* collision are about one in
four — not a bet worth taking on the most-used facet in the app.

So the hash is a **preference** now, not a verdict: each type's values are laid out over
the palette once, and a value that finds its hashed slot taken moves to the next free one.
Nothing else changes. Crucially the layout depends on the type's *value set*, never on what
is currently drawn — for an enum that set is the registry's declaration, and for a free
string it is the self-excluded facet list, which by construction does not move when you
filter by that same type. **Filtering by sport still never repaints the sports.**

Past ten values of one type it wraps and two values share a colour again. That is a real
limit in the honest place for it: an archive with eleven trips gets one repeat, not a
broken layout.

### Spatial filtering is the viewport

**You don't draw a box; you look at a place.** The camera's own bounds *are* the `bbox` term,
refetched on a debounced `moveend`. There is no drag handling, no overlay rectangle, no armed mode
and no fight with MapLibre's own shift-drag.

There is no toggle either. It began as one, because a filter that follows the camera while the
camera follows the filter is a loop, and the switch doubled as the lock that broke it. But the
loop is broken just as well by letting the camera fit exactly once — before any viewport has been
recorded — and never again: `filter.bbox === null` is the whole condition. That opening fit frames
everything you have; from then on the map is the filter, and a control that only ever wanted to be
on is not a choice worth offering.

The camera still fits itself: to the selected activity when you pick one, and to everything
matching otherwise. What makes that safe is *what the fit is keyed on*. Every fit ends in a
`moveend` that writes the viewport back as the new bbox, so keying on the filter as a whole would
make each fit the cause of the next. The key is the filter **with its bbox removed**, plus the
selected id — what you did, not what the map did in response — so a fit's own write cannot
retrigger it and the loop cannot form.

A fit waits for the data that defines it: the detail for a selection, the facets for a filter
change. Until they land the key stays unclaimed, so the fit happens when they arrive rather than
never. And `extent` is read as null while a request is in flight, because react-query holds the
previous response as placeholder data and framing the old filter's extent for the new one would
fly the camera somewhere it was never asked to go.

Getting back out by hand is a camera control, not a filter to clear: *zoom out to all activities*
in the map chrome flies to `facets.extent`, the extent of everything matching the filter with its
bbox term dropped. Self-excluded exactly as a facet is, and for the same reason — it answers "where
is the rest of it?", which the viewport-filtered payload cannot, because the viewport is what
removed it. The move then writes the wider viewport back as the new bbox, like any other pan. The
area is never cleared; it is only ever replaced by looking somewhere else.

For the same reason the bbox is not a filter *term* anywhere in the UI — no chip in the top bar, no
card in the sidebar, and no weight in *clear filters*, which now leaves the viewport exactly where
it was. A term you cannot remove, drawn beside terms you can, is a button that lies. What survives
is the one place the distinction earns its keep: an empty list says *nothing in this area* when
something exists outside it, and *import some activities* only when `extent` is null and there
genuinely is nothing anywhere.

The bbox is the whole canvas, including what shows through the translucent panels. Insetting it to
the unobstructed strip would hide a track that is plainly visible, which reads as a bug.

Two stages, and the first is what makes the second affordable. Cached bounding boxes discard
almost every activity by comparing four numbers; the exact point test then runs only over what
survives:

```sql
SELECT DISTINCT activity_id FROM trackpoints
WHERE activity_id IN (
    SELECT id FROM activities
    WHERE min_lat <= ?max_lat AND max_lat >= ?min_lat
      AND min_lon <= ?max_lon AND max_lon >= ?min_lon)
  AND lat BETWEEN ?min_lat AND ?max_lat
  AND lon BETWEEN ?min_lon AND ?max_lon;
```

The prefilter is an over-approximation and is never the answer: a point-to-point ride's box can
blanket a city it only skirted. Sampled at 200 random viewports, bounding boxes alone got 26% of
neighbourhood-sized boxes wrong, one of them by 44 activities. The second stage is what makes it
exact — the first only makes it cheap.

The only theoretical gap — a track crossing the viewport with no sampled point inside it — is
irrelevant at one-second sampling.

It is resolved to an activity-id set **once per request**, and every WHERE clause the route
builds reuses that set. This is not an optimization detail but the shape of the code: `facets`
builds eleven clauses from one filter — a summary, two per tag type, and one per range — so
resolving inside `whereFor` ran the same million-row query eleven times for a single request.
Measured over the archive that was 493ms for a wide viewport; carrying the ids on a `Scope`
makes it 55ms, and makes the mistake hard to reintroduce.

---

## Filters & UI

The map runs full-bleed and every panel floats over it, frosted and rounded, rather than sitting
in a docked column. Filters are on the left, the activity list on the right, and each collapses to
a slim rail so the map can be seen unobstructed. Filter state lives in the URL, so any view is
bookmarkable.

The top bar carries the totals *and* the active filter, as a chip per term that removes
its own term when clicked. The sidebar says what a filter could be; only the chips say what
it is — and they stay visible when the sidebar is collapsed, which is exactly when you have
stopped adjusting the filter and started reading the map under it.

A list row is a coloured bar plus title, distance, elevation, duration and date. The bar follows
the active *colour by* rather than being hardwired to sport, so the list and the map never read as
two different legends. Clicking one selects it — `?activity=123` — and the right panel swaps to a
read-only detail while the full-resolution track draws over the simplified one. Selection is
single; the checkboxes and shift-click ranges belong to the M4 flow that needs them.

Nothing dims, and hovering and selecting look the same. Both were arrived at by removing things
that seemed obviously right. Dimming the rest answered "which one is it?" by deleting the context
that made the answer worth having. Painting the selection a fixed near-black threw away the sport
or trip its colour was carrying — saying "different kind of thing" where it meant "the one you
picked". And drawing selection more heavily than hover implied a distinction that does not exist:
both mean *this is the track you mean*, so they share one paint definition rather than two free to
drift.

What is left is a highlight: the track's own colour turned up — hue untouched, saturation raised,
lightness pulled into one narrow band — over a dark casing. The casing is dark because the basemap
is pale; it began white, which against that is not a casing at all. Dark also survives the
basemap gaining colour, which a light casing tuned to one background would not have. A
selected activity differs from a hovered one in one respect only, and it is not visual: its
geometry is the full-resolution track rather than the simplified line.

Zero results show an empty state naming the facets doing the narrowing, with the map holding its
camera rather than lurching at empty bounds. A filter change keeps the previous results on screen
until the new ones arrive, so nothing flashes empty mid-drag. The layout is fluid to about 1100 px;
below that the panels would eat the map, and it says so instead of degrading. This is a desktop
tool and does not pretend otherwise.

| Group | Facets |
|---|---|
| Core | Date range · tags of any registered type (include / exclude / *not set*) · the map viewport |
| Ranges | Distance, elevation, duration, average speed — dual-handle sliders over histogram backgrounds, so the distribution is visible while you drag |
| Presets | Last 30 days · this year · **not set**, per type |

Average speed is `distance_m / duration_s`, computed in SQL rather than stored. An activity
missing either input has no speed, so it is absent from that histogram and matches no speed
range — the same way an untagged activity matches no `sport:` term. Every range facet treats
nulls that way, which is what keeps narrowing a filter monotonic.

A preset resolves to concrete dates the moment you click it: *last 30 days* writes
`from=2026-07-26&to=2026-08-25`, not `date=last30`. One representation of a range in the URL,
nothing on the server ever computes *now*, and a bookmark means the same thirty days a year from
now. The popover re-highlights a preset when the current range happens to match it.

### Counts are self-excluded

Every facet is counted over the active filter **minus its own terms**. Selecting `sport:hike`
still shows `bike 102` beside it, so the sidebar keeps telling you what widening would give
instead of collapsing to a column of zeroes; but those counts do still respect an active date
range or viewport. Range sliders work the same way — their endpoints come from the self-excluded
filter, so choosing a sport rescales the distance axis to the useful range while dragging distance
can never rescale distance. A handle at the top of its track therefore means *unbounded*, not *at
the current maximum*, or widening some other facet would silently apply a cap you never set.

Costing one query per facet group is the price, which at 197 rows on a local file is not a
price.

> **The discipline that holds this together:** one filter serialization, defined once in
> `packages/core` and imported by both the server and the browser. Every endpoint parses
> filters with the same code, so "the current filter" means precisely the same thing on the
> map, in the list and in the charts. This is the single biggest reason the stack is one
> language.

Tags serialize as a repeated generic key rather than one query parameter per type, so a new
type never has to claim a parameter name that another filter might already want. Within a
type the values are ORed, across types ANDed; a leading `-` negates, and an empty value means
*absence* — unambiguous because the grammar forbids an empty value anywhere else.

```
?tag=sport:bike&tag=sport:hike&tag=-trip:Balkan 2026&tag=trip:
     └── bike or hike ───────┘  └ not that trip ──┘  └ no trip at all
```

Everything else is a plain named parameter, and every range is **two** of them rather than one
compound value — `distance_min` / `distance_max`, matching `sort_key` / `sort_order`. An absent
bound simply means unbounded, so there is no `..` syntax to parse, escape or explain.

```
?tag=sport:bike&tag=-trip:Balkan 2026
&from=2024-01-01&to=2024-12-31
&bbox=13.68,46.31,13.86,46.44
&distance_min=0&distance_max=50000&elevation_min=500&duration_max=7200&speed_min=4.2
&sort_key=distance&sort_order=desc&colour_by=sport&activity=123&grouped=0
```

Units in the URL are **SI** — metres, seconds, metres per second — because those are the column
units, so nothing converts on the way in and the boundary has no rounding question. The browser
converts for display, which it must do anyway. `bbox` is GeoJSON order: `minLon,minLat,maxLon,maxLat`.

The URL carries the filters *and* the view state that changes what you see — `colour_by`, the sort,
the selected activity and whether the map groups — but not the camera. The camera auto-fits to the filter, so a bookmark
reproduces the view without storing it, and pan/zoom never churns history. The one case where the
camera *is* meaningful is `bbox`, and there it is already a filter term.

### API surface

| Route | Returns |
|---|---|
| `GET /api/activities?<filters>` | List rows, ordered by `sort_key`/`sort_order` |
| `GET /api/tracks?<filters>` | The simplified polylines, still encoded; each carries its `id`, `tags` and `year` |
| `GET /api/facets?<filters>` | Summary totals, per-value counts, range bounds + histograms, and the bbox-excluded `extent` — all self-excluded |
| `GET /api/activities/:id` | Detail plus the full-resolution track, encoded at precision 6 with altitude alongside |
| `GET /api/tag-types` | The registry, which the browser needs to render and validate |
| `GET /api/stats?<filters>` | Aggregates for the analytics views — **M5** |
| `GET /api/heatmap?<filters>` | Grid cell counts — **deferred** |
| `POST` / `DELETE /api/activities/:id/tags` | Tag mutations for one activity — **M4** |
| `POST /api/tags` | Bulk: a filter plus `add` / `remove`. The lever that makes 500 untagged activities tractable, and nearly free once filters are shared code — **M4** |
| `POST` / `PUT` / `DELETE /api/tag-types/:name` | Registry mutations. Delete and enum-shrink cascade onto activities — **M4** |

**Rows, geometry and facets are three routes, not one payload.** They change at different rates and
for different reasons: the geometry is the same bytes whether you are sorting the list or not, and
the facets are ten small aggregates where the rows are one big select. Three cache keys let each
settle on its own. The client holds every matching row — 197 activities is 214 KB of polyline
total — so nothing paginates. Geometry travels encoded on both routes: point objects cost 2.65 MB
for a single 34k-point activity, and the decoder that avoids it is one loop the browser was already
making to paint what it received.

The contract itself is **Zod schemas in `packages/core`**, parsed at both ends. The filter parses
from `URLSearchParams` through the same schemas, so a malformed URL is a 400 naming the field
rather than an undefined three frames later.

---

## Analytics

Analytics recomputes over whatever the filter currently selects — so "gravel rides in the Alps
in 2024" is one filter away from a full breakdown. No compare-to-previous-period selector.

- **Volume trends** — distance, elevation, moving time and count by week, month or year, split by the values of any tag type.
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
├─ packages/core     # tag grammar · THE filter serialization · the API contract
├─ packages/server   # schema · ActivitySources · Hono REST API · CLI
├─ packages/web      # React · MapLibre · ECharts
├─ migrations/       # drizzle-kit
├─ fixtures/         # recorded Strava & Komoot responses
└─ data/             # gitignored: tracks.db, Komoot raw payloads
```

**Core is what both sides run identically, and nothing else.** It held the schema, the timezone
derivation, the simplifier and the `ActivitySource` interface for as long as the server was its
only consumer, which made *shared* and *server-side* indistinguishable. A browser makes the
boundary observable, so those four moved into `packages/server` and core was left with the tag
grammar, the filter serialization and the API contract — whose only dependency is Zod, which both
sides run. The browser cannot accidentally bundle drizzle or a timezone dataset, because they are
not reachable from anything it imports; no subpath exports, no tree-shaking to trust.

| | |
|---|---|
| **Language** | TypeScript end to end. Every heavy-geo case that would have justified Python — FIT parsing, segment matching, performance analysis — is an explicit non-goal, and a shared filter package is worth more than a stronger geo ecosystem. |
| **Driver** | `better-sqlite3`. Required by drizzle-kit, which does not support `node:sqlite`, and hardened besides. |
| **Query layer** | Drizzle for schema, migrations and CRUD; hand-written SQL for spatial queries and aggregations, where query builders are worse than the SQL they generate. |
| **Migrations** | Always generated with an explicit name: `pnpm db:generate --name add-elapsed`. Without `--name`, drizzle-kit invents one like `0000_sharp_lily_hollister`, which tells a future reader nothing. |
| **Not Deno** | Better DX and a genuinely useful permissions model, but drizzle-kit + `node:sqlite` is an open bug needing a community patch — a patched migration toolchain is the wrong place to spend novelty. |
| **Validation** | Zod, in core, for the filter and every response shape — parsed on the way in *and* on the way out. |
| **Web build** | Vite. In development the Hono app runs inside it via `@hono/vite-dev-server`, so one command HMRs both sides; `tracks serve` mounts the built `dist` beside the API. |
| **Web state** | No router — the app is one page, and core already parses the query string. A `useFilterState` hook over `useSyncExternalStore` is the whole of it. TanStack Query keys on the serialized filter, so cache invalidation and the URL are the same fact. |
| **Map** | `maplibre-gl` driven imperatively from a hook. Feature-state hover and a viewport-derived filter are both things a declarative wrapper would be in the way of. |
| **Styling** | CSS Modules over one token file. Three tiers: `styles/tokens.css` holds every colour, radius, shadow and step of the type scale; `components/ui/` holds primitives that each own one visual idea; feature components compose them and contain no raw values. A hex code appears in exactly one file. |
| **Fonts & icons** | `@fontsource-variable/manrope` and JetBrains Mono, installed and bundled — a Google Fonts link would make "no data leaves the machine except tile requests" false. Icons are `lucide-react`. |
| **Testing** | Vitest in two projects: `node` (core, server, msw-replayed Komoot, file fixtures for Strava) stays offline and under a second; `web` (jsdom) covers the components and mounts the whole app against a mocked API. `--project node` keeps the fast lane. Map styles are checked against `@maplibre/maplibre-gl-style-spec` — validated *and* evaluated against the features each layer will actually meet, because the expression bugs that matter are legal ones that meet the wrong data. |
| **CLI** | `tracks import` and `tracks serve [--port 8080] [--open]`. Nothing else — tagging belongs in the UI. A missing web build exits naming the build command rather than serving 404s. |

---

## Milestones

Strava leads because it is entirely offline: the schema and import pipeline get debugged
against files on disk, with no network, no credentials and no rate limits, before the
undocumented Komoot API is attempted. There was no UI until M3, so M1 through M2.5 were
inspected through a SQLite browser.

| | | |
|---|---|---|
| **M1** | Strava archive → SQLite | Schema, migrations, the `ActivitySource` interface, `tracks import <path>`, GPX + TCX parsers, timezone derivation. |
| **M2** | Komoot | Second source behind the same interface, with recorded fixtures replayed through msw. Needed no interface change, which validated the M1 abstraction. |
| **M2.5** | Typed tags | The `tag_types` registry, the `<type>:<value>` grammar and validator in core, per-source auto-tagging, and a migration that rewrites the existing arrays. No UI — done before M3 so the map and sidebar are built against the final tag model rather than twice. |
| **M3** | Map, list and filters | `tracks serve`: the REST API, the MapLibre map with hillshade and contours, the synced activity list, a read-only activity detail, and the full filter sidebar with viewport spatial filtering. Lands in three commits — the core split, the backend, the browser. |
| **M4** | Tagging | Tag UI and tag-driven filtering, including whatever makes 500 untagged activities tractable. Free-text search arrives here too, since the flow that needs it is finding untagged activities by name. |
| **M5** | Analytics | The four ECharts views, scoped to the active filter. |
| **M6** | Heatmap and coverage | "Everywhere I've been", percentage of terrain covered, new-versus-repeated per activity. |

---

## Considered and rejected

Recorded because the reasoning is worth more than the conclusion — and because a future reader
will otherwise propose all of these again.

| Rejected | Why |
|---|---|
| DuckDB | Columnar storage earns nothing at this scale, and it is single-writer — hostile to interactive tagging. |
| Strava API (Standard tier) | Requires a paid Strava subscription since June 2026. The free bulk archive gives the same data for a personal tool. |
| FIT parser (`@garmin/fitsdk`) | A real archive contains zero FIT files — only GPX and TCX. Add one if a future export needs it. |
| CSV as sport fallback | Its sport vocabulary is localized to the account language. Two untyped rides are tagged by hand instead. |
| Deno 2 | drizzle-kit has an open bug with `node:sqlite`; the workaround is a third-party patch on core tooling. |
| H3 cell precompute | Deferred with the heatmap. The trackpoint table supports it and every alternative. |
| Point objects on the detail route | 34k `{lat, lon, altitudeM, recordedAt}` objects is 2.65MB for one activity — JSON overhead, not resolution. The same points encoded at precision 6 are lossless and 0.07MB; with altitude alongside, 0.30MB. Timestamps went with it: nothing had ever read them, and they are still in the database. |
| Decoding polylines server-side | Kept the browser codec-free, but meant ~50k JSON coordinate arrays per response: 1.14 MB, and more time in `JSON.stringify` and Zod than in the query. The browser already rebuilt every feature to paint it, so the decode joined a pass that existed. 28.3 ms to 2.6 ms. |
| `trackpoints_spatial` index | 35MB to prune one dimension of two. A cached bbox column with an exact SQL refine is the same answer for 6KB, and faster zoomed in. Adopted in 0002 — an earlier draft rejected the idea when the refine was imagined client-side, in turf. |
| `sport_raw` | Already in the on-disk raw JSON. Duplicating the archive into the DB for a query nobody runs. |
| `local_date` | Derivable from `started_at` + `utc_offset`. Denormalization that can drift, for an index nothing needs. |
| `deleted_upstream` | Undetectable with an incremental sync anyway — a deleted activity is indistinguishable from an unlisted one. |
| `kind` discriminator | Reserved space for planned routes that have no design. Adding a nullable column later is trivial. |
| Self-computed metrics | Segment metrics must be dynamic regardless, so storing whole-activity copies duplicates code that already exists. |
| `sync_runs` / `sync_state` | The full-list-plus-missing-streams strategy makes the database its own sync state. |
| Tags join table | Still no join table for *assignments*: a JSON array with `json_each()` does the job at this size. The registry that arrived in M2.5 holds types, not values, so tags never gained ids. |
| `tags_auto` / `tags_manual` | Traded for the type prefix. Which tags the importer owns is a property of their type, not a second column. |
| Reserved sport vocabulary | Superseded by `<type>:<value>`. A prefix removes the collision outright; reserving names only forbade it. |
| `sport:other` | An unrecognised sport now derives nothing and reads as *not set*. Keeping `other` would also mean the importer resurrects the value every time you delete it. |
| Per-value colour in the registry | A type has one colour, for chips. Track colours are hashed from `type:value` in the browser, so adding a trip needs no registry edit to be visible on the map. |
| Sport vocabulary in `packages/core` | It describes what Strava and Komoot emit, not what you mean — so it lives in each source, and the browser never ships a table it cannot use. |
| Bare, untyped tags | One parse rule is worth the extra keystrokes. Allowing both would make `alps` and `place:alps` two tags that look identical. |
| A generic `tag:` type | No junk drawer: every type is a facet you introduced deliberately, which is what keeps the sidebar and the colour-by selector meaningful. |
| Cross-service dedup | The two accounts cover different activities. Merge logic would be risk without benefit. |
| Tag export / backup | Accepted risk, deliberately. Tags are the only non-regenerable data in the system. |
| Observable Plot | More elegant, but the calendar heatmap and map-linked cursor would both be hand-rolled. |
| MapTiler · OSM raster | MapTiler costs a key and a quota for contour lines alone; raster OSM has no hillshading and a usage policy this would strain. |
| Schema and timezone in `packages/core` | True while the server was core's only consumer. A browser makes *shared* and *server-side* different things, and core is the first one. |
| A `description` column | Only Strava has one, so 124 of 197 rows would be null, and reaching them means the backfill problem below. Text search moves to M4 and searches titles. |
| A drawn spatial box | The viewport already expresses "this area", and turning it into the filter deletes the drag handling, the overlay, the armed mode and the shift-drag conflict. |
| A *filter to this area* toggle | Broke the camera/filter loop by locking auto-fit, but a single opening fit breaks it just as well. A switch whose only useful position is *on* is not a choice. |
| Symbolic date presets | `date=last30` puts two representations of one range in the URL and makes *now* a server input. Presets resolve to dates on click instead. |
| Pinning the seeded sport colours | Reintroduces the per-value colour table already rejected above, just in the browser instead of the registry. Everything hashes. |
| One combined `/api/activities` payload | Rows, geometry and facets change at different rates; three cache keys let each settle without refetching the other two. |
| Hono RPC (`hc<AppType>`) | End-to-end types for free, as an inferred blob nobody can read, coupling the browser to the server's framework. Zod schemas in core are the readable version. |
| List pagination | 197 activities is 214 KB of polyline. The client holds all of it, so sorting is a query key and nothing has an offset to get wrong. |
| A router library | One page, one query string, and core already parses it. `useSyncExternalStore` over `history` is the whole requirement. |
| `hillshade-vectors` | Pre-baked shading composites like any vector layer, but its light angle and intensity are fixed. The `raster-dem` source is tunable and also feeds the contours. |
| A contours toggle | A contour is a property of the basemap, not a filter. One display toggle would invent a map-options surface that nothing else needs. |
| Rendering M4/M5 controls inert | A dead button invites a click and answers with a shrug. The layout absorbs the analytics switch and the bulk-tag button when they do something. |
| Multi-select in M3 | Selection sets, a selection summary and a clear affordance, built a milestone before the bulk-tagging flow that consumes them. |
| A pure hash for colours | Collided `sport:bike` with `sport:hike` in the real data. The hash survives as the *preference*; collisions now probe to the next free slot. |
| Per-value colours in the token file | Nothing in CSS can read them — they are painted into GeoJSON properties and passed as props. A round trip through `getComputedStyle` bought nothing and failed silently, since an empty string is a valid CSS value and an invisible track. |
| *Colour by nothing* | A single-colour map answers no question the list does not answer better. The default is the registry's first type instead. |
| Clusters as a circle layer | A circle layer paints one colour per feature, and a cluster is a mixture. Donut markers over the canvas, tallied by `clusterProperties` inside the clustering worker. |
| A separate cluster-count layer | The donut carries its own number in the middle of the ring. |

---

## Still undecided

**Heatmap implementation** *(M6)* — Two live candidates. An on-the-fly SQL grid —
`GROUP BY round(lat,4), round(lon,4)` — needs no dependency, no precompute, and respects the
active filter for free. Precomputed H3 cells give equal-area hexagons and instant
set-difference queries for "was this new terrain?", at the cost of an import step that is
filter-blind. Nothing in the schema forecloses either.

**Tag UX** *(M4)* — Deferred until the UI exists. The mechanism is settled — bulk-apply over
the current filter, paired with the per-type *not set* preset — but not the workflow that
makes 500 activities tractable, nor how a type is created without leaving the tagging flow.

**Tag mutation contract** *(M4)* — Settled ahead of its milestone: `POST /api/tags` takes a
filter, the per-activity routes take one id, and both run the same merge, where assigning a
single-valued type replaces rather than appends.

**Backfilling a new derived type** *(M2.5)* — `importSource` skips any activity that already
has trackpoints, which is what makes re-import cheap. So a type added to the registry later
does not reach existing rows by re-running the import; it needs a one-off rewrite. Not a
problem yet — `source:` is handled by M2.5's own migration — but the second auto-derived type
will have to answer it.
