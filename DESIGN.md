# Tracks — Design Brief

One map for everything you've ridden and walked — pulled from Strava and Komoot,
tagged, filtered and counted on your own machine.

| | |
|---|---|
| **Deployment** | One Edge Script at [tracks.stho.net](https://tracks.stho.net), over Bunny Database |
| **Dataset** | 197 activities (73 Strava, 124 Komoot), 1.02M track points |
| **Stack** | Node 24 · pnpm · libSQL · React · MapLibre · Deno at the edge |
| **Status** | M1–M8 complete |

---

## Scope

You open it in a browser and sign in, and an account sees its own activities and nobody
else's. The tool imports them from Strava and Komoot, draws them on a map, lets you tag
and filter them, and counts them.

It was local-only for six milestones and is not any more: it lives at `tracks.stho.net`,
as one Edge Script over a database in Frankfurt. What survived the move is the shape of
the thing — the browser still reads Strava and Komoot itself, so a Komoot password still
goes from the tab to Komoot and nowhere near the server, and a Strava export is still
never uploaded whole. What changed is where the rows live, which is no longer "your
machine" and is now "a database only you have an account on". `pnpm dev` runs the same
server against the same database, so there is no local copy to drift.

### Non-goals

| | |
|---|---|
| **Segment & route matching** | "Have I ridden this climb before, was I faster?" needs map-matching and track-similarity work. A separate project, and Strava already does it. |
| **Performance analysis** | No heart rate, power, cadence, zones or fitness modelling. Out by construction — only GPS, elevation and time are stored. |
| **Writing back upstream** | Strictly read-only sync. No pushing tags, renames or edits to Strava or Komoot. Keeps the blast radius of any bug at zero. |
| **Photos and media** | Both services attach photos. Not imported, not displayed. |

Route planning arrived in M8, and took none of the space that had been left for it: a plan
is a fragment in the address bar, not a row. The nullable column stayed unwritten, which is
cheaper than the safest migration there is.

### Conventions

Metric throughout (km, m, km/h). ISO dates. Weeks start Monday.

---

## Ingestion & sync

**The browser reads; the server writes.** Both sources run in the tab, and the server
receives finished activities without knowing where they came from. This is the single
decision the rest of this section follows from.

| Source | Access | Risk |
|---|---|---|
| Strava | **Bulk archive import** — the downloaded `.zip`, read in the browser | None; a local file, never uploaded whole |
| Komoot | Undocumented `api.komoot.de` v006/v007, called **from the tab** | Can break without notice |

### Why the browser does the reading

Komoot answers with `Access-Control-Allow-Origin: *` on both the v006 login and the v007
tour endpoints, and its preflight permits `Authorization`. Verified against the live API,
and the whole design rests on it: because a tab may call Komoot directly, **your password
never reaches the server** — there is nothing to store, leak or forget to discard.

A Strava export is a file you already have, and the importer opens exactly two things in
it: `activities.csv`, and the paths named in its column 12. Photos, comments, followers,
clubs and routes are the bulk of the archive and are never read. Uploading the whole zip
to reach the tracks inside it was only ever a consequence of the parsers living on the
wrong side of the wire.

So the sources moved to `packages/web`. The server kept what only it can do — the timezone
dataset, the simplifier, the bounding box, the tag registry — and stopped knowing what a
Strava export or a Komoot tour is.

The move also paid for itself in dependencies. `DOMParser` replaces `fast-xml-parser`,
`DecompressionStream` replaces `node:zlib`; reading an archive costs one new dependency
(`@zip.js/zip.js`) rather than three. zip.js reads the central directory off the end of
the `File` with range reads, so opening a 500 MB export costs a few KB and each entry is
inflated by name.

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

### The import, end to end

1. The browser lists the source — a zip's CSV, or Komoot's paginated tour list.
2. It offers the ids to `POST /api/import/select`, which answers with the ones the
   database has no track for. A re-import gets an empty list and **fetches nothing**.
3. It reads only those, one at a time, and serializes each as an NDJSON frame.
4. It posts them all to `POST /api/import/:source`, which writes them and streams its
   progress back.

Two phases rather than one continuous stream because streaming a *request* body needs
`duplex: 'half'`, which only Chromium ships. Buffering between them costs the browser
~25 MB on a first import of a full account and nothing afterwards — and all-or-nothing is
what the server's single transaction does anyway.

One line per activity: `[lat, lon]` through the polyline codec at precision 6 (lossless,
and the same one the detail route uses), with altitude and time as parallel arrays that
collapse to a single `null` when a track carries neither. Times are seconds from the
start rather than ten-digit epochs. `source:` is **not** on the wire — the server derives
it from the frame's own `source` field, so a client cannot send a column and a tag that
disagree.

### Why there is no cursor table

Re-importing is idempotent. Every run lists the whole archive (or the whole Komoot tour
list) and upserts by `(source, external_id)`; an activity that already has a track is
never fetched, because `select` filtered it out before anything was read. The database is
its own sync state — there is no cursor to corrupt and no `after=` gap that could silently
skip a range.

**Resumability was traded away in M3.5, deliberately.** The whole run is one transaction
now, so a crash loses it rather than leaving rows for the next run to fill. That is the
price of an undo that does not need writing — see *Cancelling* below — and on a 197-tour
account it costs one repeated pull.

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

These are split across the wire. The browser owns what is a fact about a *service* —
which sport a word means, which name to prefer. The server owns what needs data the
browser must not ship, or that every writer must agree on.

**Timezone.** *Server-side.* Nothing in the archive records a UTC offset — the CSV date is UTC and matches
the GPX `Z` timestamp exactly. So the offset is derived from the track itself: the first
trackpoint's coordinates give an IANA zone via `tz-lookup`, and the zone plus the activity's
date gives the offset with DST handled. Independent of file format, and it works for Komoot
too.

**Sport.** *Browser-side.* Taken from the file — GPX `<type>`, TCX `Sport` — which is English and
locale-independent. There is no CSV fallback: an activity whose file carries no type gets no
automatic sport tag and is tagged manually. Each source maps its own vocabulary to a `sport:`
tag itself rather than handing a raw string to the pipeline, so Komoot's `touringbicycle` and
Strava's `cycling` are two facts about two services that are free to drift apart. A string
neither source's map recognises derives nothing at all, and one no registry type accepts is
dropped and reported rather than failing the import — except for `sport:` and `source:`
themselves, whose types the importer recreates from their seeds when the archive is empty
enough to have lost them. Accordingly, **re-derivation only acts
when the source supplies a type**; where it does not, existing tags are left untouched, so a
manual sport tag survives every future import.

**Title.** *Browser-side.* The file's own name, falling back to the CSV title. This preserves original names
from third-party uploads — *"Almenrunde"* rather than Strava's auto-generated *"Fahrt am
Morgen"*.

### Sync rules

| | |
|---|---|
| **Duplicates across services** | Not merged. The two accounts cover different activities; a `source` column lets you split when it matters. |
| **Upsert key** | `(source, external_id)`. A known activity is **left alone entirely** — not fetched, not written — so an upstream rename never lands. The cheap re-import is the point, and the title you care about is usually the file's own anyway. |
| **Deletions** | Not tracked. Local rows persist. |
| **Trigger** | Manual, from the Import button. No scheduler, no background daemon. |
| **Raw payloads** | **Not archived.** `data/raw` is gone: the archive only ever protected against re-fetching, and a re-import never re-fetches a track it already has. `data/` holds `tracks.db` and nothing else. |
| **Cancelling** | Rolls back everything, via one `BEGIN … ROLLBACK` on a second SQLite connection. The request owns the run, so closing the tab is a cancel. |

---

## Secrets & auth

**There is no server secret.** Not "the secrets live in a file" — there is nothing to
configure, nothing to deploy, nothing to lose and nothing to rotate.

Strava needs no credentials — the archive is a file you already have. Komoot needs an email
and a password, and since M3.5 they are typed into a dialog that calls `api.komoot.de`
**directly from the tab**. They are never sent to the Tracks server, never written to disk,
and never held past the run: you are asked again next time, which is the honest cost of
having nowhere to keep them.

That deletes a whole category of thing to get right. No environment variables, no
secrets-env, no OAuth flow, no token file, no rotation, and no process holding a session
token it might log.

Since M6 there is one credential the tool does keep, and it is yours. An account is an
address and a PBKDF2 hash; a session is an HMAC-signed cookie carrying a user id and its
own expiry, checked server-side rather than trusted from the cookie's `Expires`. The key
that signs it is **derived from that account's own stored hash**, which is what leaves the
system secretless — and what makes a password change a revocation: every cookie already
issued was signed with a key that no longer exists. Per person, at once, with no sessions
table to sweep and nothing to remember to sweep it.

It is paid for twice. Verifying a cookie means knowing whose it is, so the user's row is
read *before* the signature is checked — free against a local file, one round trip when the
database is elsewhere. And a secret kept outside the database is a second wall: it means a
stolen database cannot mint sessions. This one can. A stolen copy of this database is
already the end of the story that wall was protecting.

Accounts are made by hand — `pnpm user:add <email>` — and carry no password until the first
sign-in sets one. No signup route exists, so nothing public writes to `users`, and there is
no reset flow because there is no mail sender: a forgotten password is the hash cleared by
the same script and the account claimed again. Until it is claimed, whoever signs in first
owns it — which is the whole reason the identifier is an address nobody guesses rather than
a name somebody would.

Everything the tool *produces* is now a single file: `data/tracks.db`.

> `data/` is gitignored, which means `git clean -xdf` deletes it — including the only copy
> of your tags.

---

## Data model

SQLite, not DuckDB — at this scale (~1M track points) a columnar engine buys nothing and
costs a second writer-hostile store. The schema started at six tables and every
cut below was justified by something being derivable, archived, or speculative.

```sql
users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,       -- the identifier; nothing is ever sent to it
  password_hash TEXT                        -- null until the first sign-in claims it
);

activities (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  track_geometry  TEXT,                     -- full resolution, polyline at precision 6
  track_altitudes TEXT,                     -- decimetres, delta-coded
  track_times     TEXT,                     -- seconds from started_at, delta-coded
  UNIQUE (user_id, source, external_id)  -- two people may each import the same ride
);

tag_types (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,              -- 'sport', 'trip', 'source'
  label         TEXT NOT NULL,              -- 'Sport'
  single_valued INTEGER NOT NULL,           -- one radio, or many checkboxes
  sort          INTEGER NOT NULL,           -- sidebar order
  PRIMARY KEY (user_id, name),
  UNIQUE (user_id, sort)                    -- unique within one sidebar, not across all
);

```

The track lives on the activity, in the three encodings `/api/activities/:id` sends. It was a
row per point until M9 — 43.1MB of a 43.5MB database, 41 bytes to carry about seven of
information — and the shape cost more than the size. A viewport filter examined 1,046,207 rows
where it now examines 203; opening one activity read 1,856 rows where it now reads 1; importing
one wrote a row per point, on the metered operation that costs a thousand times more per row
than a read. All measured on the deployed database.

Lossless to the precision the sources themselves report: coordinates within 5.57cm and altitude
within 5cm, against a receiver with 1-3m of error, verified over all 1,045,599 points. So the
table can be rebuilt from the columns in under a second, which is what makes dropping it a
storage decision rather than a one-way door — querying points in SQL is rented, not owned.

### Whose rows

An owner column on two tables, and one type that carries it. `Scope` was built in M3 to
make facets cheap — a filter plus the activities its bounding box selects, resolved once so
eleven `WHERE` clauses share one resolution of it. M6 made it the security boundary as
well: it gained a `userId`, `whereFor` emits `a.user_id = ?` first and unconditionally, and
the `Exclusion` that lets a facet drop its own terms may never drop that one.

Every function in the data layer takes a `Scope`, or an `Owner` where there is no filter to
carry — so a query that does not say whose rows it means will not compile. That is the
point, because the filtered reads were never the exposure: they all went through one funnel
already. The exposure was the three that did not. `activityDetail` and `writeActivityTags`
took an id and nothing else, and the import's `selectWanted` matched on source and external
id. Those are the routes where one person would have reached another's ride, and they are
exactly the ones a rule written down in a comment keeps missing.

A "not yours" and a "no such activity" answer identically — same status, same sentence —
because telling them apart tells a stranger what exists.

There is no index on `lat`/`lon`. One existed and cost 35MB — better than a third of the
database — to range-scan a latitude band and then test longitude row by row, because a B-tree
orders on one dimension and the second half of its key pruned nothing. The four bounding-box
columns on `activities` replace it with 6KB, and answer the same question faster.

### Tags

Every tag is `<type>:<value>` — `sport:hike`, `trip:Balkan 2026`, `source:komoot`. The
assignment stays a flat JSON array on the activity, queried with `json_each()`. What the
schema gains is a registry of the *types*, because a type carries the two things a bare
string cannot: whether an activity may hold more than one, and how the sidebar says it.

| Seeded type | Single | Written by |
|---|---|---|
| `sport` | yes | import |
| `trip` | yes | you |
| `source` | yes | import |

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

**A type declares no vocabulary.** `enum_values` was the registry's third column and the last
place a value could be *wrong*: `sport` listed `bike`, `hike`, `run`, the UI refused anything
else, and an importer deriving `gravel` put it back into the enum, because a source's
vocabulary is a fact and the registry is a preference. That rule was the tell. If a value the
data contains is always allowed to join, then the enum is not a constraint — it is a slow
copy of `SELECT DISTINCT`, kept in sync by a re-add path, an enum-shrink cascade and a
validator branch, all to describe what the tags already said. So a type's values are simply
the ones in use, and `validateTag` is down to the grammar and the type. What guards against
`balkan 2026` is the autocomplete, which is where it was doing the work anyway; what keeps
`sport:` clean is that each source maps its own vocabulary in code, and a hand-typed sport is
a sport you went and did.

**Types only — still no tag ids.** The registry holds types, never values, so `trip:Balkan
2026` remains a string in an array: tagging is one `UPDATE`, and there is nothing to garbage
collect when the last activity loses a trip. Renaming is therefore not an operation at all —
it is re-tagging, and for a single-valued type that is one bulk add, since the new value
replaces the old on every row and the old one ceases to exist by having no rows left.

**A type lives exactly as long as its last tag.** The registry is not administered: there is
no delete-type control and no cascade dialog, because deletion is what *happens* when nothing
carries a tag of a type any more. A GC after every write drops those rows. That makes the
registry a description of the data rather than a second thing to keep in step with it, and it
decides two smaller questions on its own — a type must be created together with its first tag,
or it would vanish before it was used; and the metadata for the types an importer owns lives
in code, so `sport` and `source` come back with the next import rather than lingering as rows
describing an empty database.

**A type has no colour column either.** It is hashed from the type name and unjammed against
the other types, exactly as a value's colour is hashed from `type:value` — one mechanism, and
one less field on a form that appears in the middle of tagging.

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
`@versatiles/style`'s `colorful`, barely held back — a slight wash towards the paper the app is
drawn on, and nothing else. It began as `graybeard`, on the principle that the tracks should own
the only colour on screen; that read as a wireframe rather than as a map of anywhere. The first
correction desaturated `colorful` by a third and took the terrain down with it, which is most of
what a map of the Alps has to say. Seating the colour under the lines turns out to need very
little, and the tracks win on saturation anyway.

Satellite imagery is the same server's raster tileset, switched from the map chrome and remembered
in the URL as view state, with the same hillshade and contours over it. Contours earn their place
there twice over: imagery says what the ground is covered in and nothing about how steep it is.
Both live in one `basemap.ts` module, which is what keeps swapping providers or dropping to a
locally-served container a one-line change.

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
almost every activity by comparing four numbers — a median of 3 survive, 95th percentile 67,
against 203 — and the line test then runs only over those:

```sql
SELECT id, polyline FROM activities
WHERE user_id = ?
  AND polyline IS NOT NULL
  AND min_lat <= ?max_lat AND max_lat >= ?min_lat
  AND min_lon <= ?max_lon AND max_lon >= ?min_lon;
```

The prefilter is an over-approximation and is never the answer: a point-to-point ride's box can
blanket a city it only skirted. Sampled at 200 random viewports, bounding boxes alone got 26% of
neighbourhood-sized boxes wrong, one of them by 44 activities — and re-measured per viewport
rather than averaged, a 400 m box reported fifty activities where three belonged. The second
stage is what makes it exact; the first only makes it cheap.

That second stage was SQL over `trackpoints` — the row-per-point table, since dropped —
until it was measured: a UDF counting row
examinations put a whole-extent viewport at 1,045,599 rows, the entire table, with no early exit
because `DISTINCT` cannot stop at the first match — three times over, since three routes rebuild
the scope per pan. It is now the simplified polyline, decoded in the isolate and tested as
*segments* rather than points. A track's points are a sampling of it, so testing them asks
whether the recorder happened to sample inside the rectangle; testing the simplified points is
worse still, missing 153 activities in 3,937 because the point inside the box is the one the
simplification dropped. The line between two kept points is the track's claim about where it went.

Identical to the old point test at 2°, 0.5°, 0.1° and 0.02° — not one activity gained or lost
across 800 viewports — and it reads 3–22 KB in the median case. It parts company only below that,
where the 10 m simplification tolerance is a visible fraction of the rectangle: one activity
missed in 2,266 at ~400 m, nine in 1,791 at ~80 m, both viewports smaller than a city block. The
costs also sit the right way round, since a wide viewport reads the most geometry exactly where
the bounding boxes were already nearly enough.

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

**The tab says what you are looking at**, as a ladder rather than a summary: an open activity
wears its own title, a plan its name — or its two ends, which is already what the name field
offers as a placeholder — and Analytics and Planning name themselves. Every one of them closes
with `· Tracks`, so a truncated tab is still this app and a bookmark still reads. The filter is
deliberately not in it: everything else in this section *is* the filter, and a tab rewriting
itself on every pan, every tag and every keystroke in the search box would be noise in the tab
strip rather than a label on it. So the whole vocabulary is an activity, a plan, `Analytics`,
`Sign in` and `Tracks` — and the quiet case is the static title `index.html` already carries,
which means the common one needs no write at all.

The top bar carries the totals *and* the active filter, as a chip per term that removes
its own term when clicked. The sidebar says what a filter could be; only the chips say what
it is — and they stay visible when the sidebar is collapsed, which is exactly when you have
stopped adjusting the filter and started reading the map under it.

At its right edge is **Import**, a dropdown with one entry per source. The chips beside it
scroll; it never shrinks, because an
action you cannot reach is worse than a filter term you have to scroll to. Beside it is the
mode switch — segments rather than buttons, because each one covers the list, so what you
are choosing between is which of them you are reading. Two of them until M8 added Planning;
the control was built to hold a set rather than a boolean, and `?analytics=true` became
`?mode=` when the set grew.

Picking a source opens a modal — a real `<dialog>`, so the platform supplies the focus trap
and the layer above the map canvas — which moves through the form, the reading, the writing
and a summary. Nothing closes on its own: a run with failures is something to read, and
while a run is going the only way out is Cancel, because the request *is* the import.
Cancelling while reading has sent nothing; cancelling while writing rolls back.

A list row is a coloured bar plus title, distance, elevation, duration and date. The bar follows
the active *colour by* rather than being hardwired to sport, so the list and the map never read as
two different legends. Clicking one selects it — `?activity=123` — and the right panel swaps to the
detail while the full-resolution track draws over the simplified one. Selection is single, and
stays that way: the checkboxes and shift-click ranges were being kept for the bulk-tagging flow,
and that flow turned out not to want them.

The detail carries an **elevation profile** of the track, against distance along it rather than
against time — timestamps are not on the wire, and the wall at km 62 is how the thing is talked
about anyway. Its distances are scaled to land exactly on the service-reported distance, which is
a few tenths of a percent from the summed polyline: two right numbers reading `87.1` and `87.4`
one row apart look like a bug, and spreading the difference keeps every readout agreeing with the
one figure already on screen.

The axis starts at the track's own minimum, never at sea level, but never spans less than 200 m —
without a floor a rolling valley loop fills the box exactly as a col does, and the shape is the
only thing the chart is for. Missing altitude is drawn as missing: a dropout leaves a gap, and a
track with no altitude at all says so in words rather than drawing a flat line that would read as
a plain. Its colour is the gradient — still deliberately not the activity's hashed colour, which
answers *which category* where this answers *how steep, here*, and one ride's terrain was never
answering the first.

**Colour runs on an absolute ramp**: dark green at −8%, light green at level, then yellow at +4%,
orange at +8%, red at +11.5% and dark red at +15%, interpolated continuously between and clamped
at both ends. Absolute rather than stretched to each track: 8% is 8% on every activity, so a
towpath draws all green and an alpine col reds out, where a per-ride scale would make dark red mean
"4%" on the towpath and the colour would carry nothing you could take to the next activity.

Level ground is green and not yellow, because green means *this is not costing you anything*,
which is as true of flat as of downhill. Descent saturates at −8%, which real descents reach
constantly, rather than mirroring +15% onto ground almost nothing reaches; the warm half tightens
towards the top, because 11% against 15% is a difference a rider feels and −8% against −12% is
not. The line and the area beneath it take the same paint, so a climb is legible as a coloured
mass rather than as a coloured hairline over a grey one.

There is no legend. The hover reads `km 12.4 · 840 m · +7.4%` with the figure set in the colour the
line under it is drawn in — the key and the value in one mark, which is the whole of what a legend
would have said. Under deuteranopia the two ends of the ramp collapse into each other, both reading
as dark olive. That is accepted rather than overlooked: red-for-steep is the convention in this
domain, the profile's shape is the first read and its colour the second, and the figure is there in
digits for anyone the colour fails.

The gradient behind it is measured across a centred 100 m window, never point to point — at the
~7 m spacing a ride records at, ±0.2 m of altimeter error is ±3% of slope, and colour taken from
that would speckle rather than describe. The window narrows at a dropout onto whatever measured
pair it can still reach, and widens on a coarse recording onto the points either side, which are
then a window apart or further; it never widens across a gap, and where no pair exists at all the
gradient is unknown and that stretch stays neutral ink. Nothing reports a gradient, which is how it
escapes the objection that sank a computed elevation gain: there is no second right number for it
to disagree with.

**The profile draws a simplification, not the track.** Ramer–Douglas–Peucker with a vertical
tolerance of `max(1 m, range / 400)` keeps a point wherever the terrain turns and drops it along a
straight drag, so points cluster through switchbacks and thin out on a canal towpath. The share of
the range keeps
the tolerance sub-pixel on a 96 px box whatever the terrain, so nothing you could see is ever
dropped; the 1 m floor stops it falling below what an altimeter resolves, so it never spends points
preserving noise. Every local minimum and maximum deeper than that survives exactly, which is what
makes the axis labels and the drawn line agree about where the summit is.

Simplification alone leaves no floor under the cursor — a long even climb reduces to its two ends —
so any surviving span longer than 50 m is subdivided again with real points. That cap is cursor
resolution and nothing else; the shape is entirely the tolerance's business. Below 2 km it shrinks
with the track, because 50 m of a 500 m walk is a tenth of it and the snap would be visible.

Hovering it puts a dot on the track; hovering the track moves the profile's cursor to the nearest
point. Every point the profile draws is one the track recorded, so the two index spaces convert by
lookup and never by interpolation, and the marker still lands on a real coordinate. One index,
resolved from whichever end moved, so the two can never disagree about which point is meant.

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
| Core | Free-text search on the title · date range · tags of any registered type (include / exclude / *not set*) · the map viewport |
| Ranges | Distance, elevation, duration, average speed — dual-handle sliders **on** the histogram, so the shape you are reading is the thing you are cutting |
| Presets | Last 30 days · this year · **not set**, per type |

Average speed is `distance_m / duration_s`, computed in SQL rather than stored. An activity
missing either input has no speed, so it is absent from that histogram and matches no speed
range — the same way an untagged activity matches no `sport:` term. Every range facet treats
nulls that way, which is what keeps narrowing a filter monotonic.

### Tagging is the sidebar

The tag UI has no surface of its own. Two controls join the panel that already holds the
values and their counts, directly under the search field — because searching and tagging are
one gesture: narrow to the activities a tag is missing from, then apply it to what is left.

**One field adds**, taking `<type>:<value>` exactly as the grammar defines it, with a dropdown
over every value in use — filtered as you type, and drawn from the whole archive rather than
the filter, since the moment you most need to be offered `trip:Balkan 2026` is when you have
narrowed to the rides that lack it. It writes over the current filter and nothing else: there
is no id list, no checkbox and no selection set, because narrowing the filter is already how
this app says which activities you mean. Its label carries the count it would write to, and it
is disabled at zero.

A type is created here or nowhere. Typing an unknown type opens two fields below the
input — a label, guessed from the name, and *one value per activity* — and the type is created
in the same transaction as its first tag. It has to be: an empty type would be collected before
you could use it. There is nothing to ask beyond those two, since a type declares no vocabulary,
picks no colour, and is never deleted by hand.

**A trash on each value row removes**, beside the `−` that excludes it, writing over the filter
exactly as it stands. It appears only on values the activities on screen actually carry — the
counts beside them are self-excluded, so a row can read `41` while the filter as it stands holds
none of them, and a trash that would write zero rows reads as a broken button. Which rows those
are is counted in the browser, from the rows it already holds.

Nothing confirms, and nothing can be undone. What guards a bulk write is that the number it
will touch is on the label of the control doing it. Tags remain the only non-regenerable data
in the system, and this is the second deliberate bet on that after the missing export.

**Afterwards, the list usually empties.** Tag everything under *trip: not set* and by definition
none of it matches any more — which is the feedback, and the reason the untagged pass converges:
the pile visibly goes down. A result line under the field says what happened, since the rows it
happened to are gone.

Single-valued types replace silently. `trip:Alps` over a set that already carries other trips
reports one number, because replacement is what the type *means* rather than an event. That is
also why renaming is not an operation: filter to the old value, apply the new one, and the old
one is left with no activities and ceases to exist.

**One activity is tagged in its detail panel**, where you are already looking when you notice the
tag is wrong. Each chip removes itself, and the same field adds. Both send the whole array, which
the panel is holding anyway — so adding and removing are one request.

A range facet is one control, not a chart with a bar beneath it. The handles ride the foot of
their own distribution and everything outside the selection is washed pale — drawn in chart
space, so the pale edge sits exactly where the handle does rather than at the nearest bucket
boundary. The handles themselves are still two stacked `<input type="range">`: keyboard support,
screen-reader semantics and pointer capture arrive with them, and none of the three is worth
re-deriving on top of a chart library. A facet with no span shows its single value and no chart,
for the same reason it has never shown a slider — one bar at full height is not a distribution.

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

Search is `q`, matched against the title with a case-insensitive `LIKE` whose wildcards are
escaped, so a title containing `%` is searched for rather than matching everything. An
activity with no title matches no search, the same way one with no distance matches no
distance range. It sits at the top of the sidebar rather than over the list, because it is a
filter term like the rest — and because it is what narrows to the ride whose tag is missing,
which is where a tagging pass begins. FTS5 would be a second copy of the titles, three
triggers and a migration, to save microseconds on a few hundred rows.

Everything else is a plain named parameter, and every range is **two** of them rather than one
compound value — `distance_min` / `distance_max`, matching `sort_key` / `sort_order`. An absent
bound simply means unbounded, so there is no `..` syntax to parse, escape or explain.

```
?tag=sport:bike&tag=-trip:Balkan 2026&q=balkan
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
| `GET /api/activities/:id` | Detail plus the full-resolution track: three strings read straight off the row — geometry at precision 6, altitude and time delta-coded |
| `GET /api/tag-types` | The registry, each type with the values in use counted over *every* activity — the sidebar renders it, the autocomplete offers it, and the colour layout is laid out from it |
| `POST /api/import/select` | Takes `{source, ids}`, returns the subset with no track yet. A pure query — no lock, no session |
| `POST /api/import/:source` | Takes NDJSON frames, writes them in one transaction, streams NDJSON progress back |
| `GET /api/stats?<filters>` | Aggregates for the analytics views — **deferred**, and possibly for good: the browser already holds every matching row, which is all four cards' input |
| `GET /api/heatmap?<filters>` | Grid cell counts — **deferred** |
| `POST /api/tags?<filters>` | Bulk `add` / `remove` over everything the filter matches. The lever that makes 500 untagged activities tractable, and nearly free because the target is parsed by the same code every read uses |
| `PUT /api/activities/:id/tags` | One activity's tags, replaced with what the detail panel is showing |

**A tag write names its target in the query string, like a read.** `POST /api/tags?tag=trip:&q=balkan`
is the filter you are looking at, parsed by `withFilter` — so what the sidebar counted and what
the write touches are the same statement, and there is no second way to hand a filter to the
server. There is no `ids` parameter and no selection set: narrowing the filter is how you say
which activities you mean. Both write routes take an optional `newType`, because a type is born
with its first tag and creating it separately would leave it empty long enough to be collected;
both run the type GC as the last thing inside their transaction.

**The import routes are the only streams.** `select` is what makes a
re-import free; the other is one request that owns the run from `BEGIN` to `COMMIT`. There
is no job id and nothing to poll, because nothing outlives the connection: if it goes away,
the transaction rolls back. `EventSource` was never a candidate — it is GET-only and could
carry neither the credentials nor the payload — so the stream is NDJSON in both directions.

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

It is a **slide-over**, not a place you go: a panel from the right edge over a scrim, with the
map still drawing underneath and the filter sidebar still live beside it. That is the whole
premise made structural — the control that changes what the charts say never leaves the screen,
and clicking the scrim puts the map back. `?analytics=true`, because it changes what a shared
link shows. It carries no summary of its own: the top bar is directly above it with the same
totals for the same filter.

- **Volume trend** — a stacked bar per bucket, with two controls and deliberately not a third.
  Bucket (week/month/year) and metric (distance, elevation, moving time, count) are its own;
  what it *stacks by* is the app-wide `colour_by`, so the map, the list bars and this chart are
  one legend, and closing the panel leaves the map coloured as the chart was. Empty buckets keep
  their slot and draw a stub: a bar of zero draws nothing, and nothing is indistinguishable from
  a bucket that fell off the axis.
- **Calendar** — a day per cell, with one range control that picks the *shape* as well as the
  range. A year, or **YTD** — this year without the empty months a full grid would draw after
  today — is one row of weeks; **All** carries that row on unbroken from the first activity to
  the last and scrolls sideways, because an archive is continuous rather than a stack of years.
  There is no chip for the current year, since YTD is it. Colouring is one dropdown with two
  sections: an *intensity* ramp of four steps cut at the 25th/50th/80th percentile of the active
  days — quartiles, so one 200 km day cannot flatten a year, and cut over everything in scope so
  a shade means the same thing in 2021 as in 2025 — or the day's *dominant tag*, which sets
  `colour_by` and therefore colours the map with it.
- **Distributions** — all four at once, no control: distance, elevation, moving time and speed in
  a 2×2 of banded bars. The sidebar already draws these four with handles on them, and the
  difference is why this card exists — those are a shape to cut, these are a table to read. So
  the bands are hand-picked and uneven (0–5, 5–15, 15–30 km is how a ride is talked about) and
  every bar carries its count, which a draggable histogram cannot.

**Clicking a bucket filters to it.** A bar writes the date range it covers, a day writes that
day, a band writes that range's bounds — each landing as a chip in the top bar, so undoing is one
click. The trend then collapses to a single bar, which is abrupt and honest.

There are **no records**. Longest, highest, fastest and longest streak were designed and cut: the
first three are one activity each, which the list already sorts to the top, and a streak measured
in days turned out to say mostly whether you were away.

**There is no `/api/stats`.** Every card needs the same input — rows carrying a local date, tags
and four metrics, over the current filter — and the browser already holds exactly that,
unpaginated, because the list and the map need it. So aggregation is pure functions rather than a
route: no schema, no second cache key, and changing a bucket or a metric redraws without a
request. They live in `packages/core` all the same, over `ActivityRow[]`, so the day a chart
outgrows those rows a route is a handler that selects rows and calls the identical function; the
two paths could not then disagree about what a month is. Analytics does not move the boundary
that decision rests on — the client already fetches every matching row — it inherits it.

The fourth view, the per-activity **elevation profile**, is not here: it belongs to one activity
rather than to a filter, so it lives in the detail panel and shipped with M3. It is what brought
ECharts in a milestone early, and the primitive it left behind — `ui/Chart.tsx`, an option in and
a chart out — is what the three views above are built on.

**ECharts**, reversing an earlier preference for Observable Plot. Its calendar coordinate system
is the calendar card: a `range` spanning years continuously is the All strip, month and year
labels included. Plot's main advantage, its statistical transforms, is neutralised because
aggregation happens in `core` anyway. The third argument made for it — `dispatchAction` making a
two-way chart↔map cursor sync trivial — belongs to the elevation profile, where the sync is real;
the analytics panel covers the map, so nothing here dispatches into a chart. One of the three
reasons simply did not cash.

It renders to **SVG**, not canvas. jsdom has no canvas and the sidebar mounts four charts in a
single component test, so canvas would have meant a mock in the setup file for charts that are
38 px tall. Charts are also built where a chart is cheapest to be wrong: every option is a pure
function tested as a value, and the component around it only mounts what that function returned.

Only service-reported metrics are stored. Anything else — consistent cross-service numbers, or
metrics for part of a track — is computed from the stored track on demand, since the dynamic path
has to exist for segments regardless. A cache table can follow later, if a chart proves slow
enough to justify one.

---

## Planning

A third mode beside Activities and Analytics, and the first one that is a *place you go*
rather than a panel over somewhere else. **Only the right panel follows the mode**: the whole
plan — its numbers, its controls and its stops — replaces the activity list, and the filter
sidebar stays exactly where it is.

Underneath it, everything you have already ridden, dimmed to resting opacity and made
inert — no hover, no click. That is the reason to plan here rather than in Komoot: *have I
been up that valley?* is answered by looking, without leaving the thing you are drawing.
Making them inert is not decoration either. Every click on the map now means "put a
waypoint here", and a click that might instead select a track is a click you have to aim.

### The plan is a fragment

It lives in `#plan=`, not in the query string and not in a table. A fragment is never
transmitted, so the one piece of state in this app that says where you are *going* stays in
the tab — the same rule that keeps a Komoot password and a Strava archive off the server,
applied to the only new data M8 creates.

It is one store all the same. `useUrlState` had a `snapshot()` of `window.location.search`;
it now returns `search + hash`, subscribes to `hashchange` beside `popstate`, and writes
`pathname?search#hash` in one go. Three parsers over two slices — `parseFilter`, `parseView`,
`parsePlan` — and one `useSyncExternalStore`, which dedupes identical snapshots, so the
double notification a hash write produces costs nothing. There is no second state mechanism,
and no second place to look when the URL disagrees with the screen.

Waypoints encode with the polyline codec the app already ships, at about six characters
each, plus a parallel string of kinds. Coordinates were never what makes a plan URL long;
names are. Both need `encodeURIComponent` on the way in, because polyline encoding emits
ASCII 63–126 and that range includes a backslash, which a fragment may not carry raw.

**Leaving the mode clears the plan.** `#plan=` exists only while `mode=planning`, so there
is no Clear control anywhere — switching away is the clear, and starting fresh is switching
back. Back is the safety net, since a mode switch pushes. The cost is stated rather than
hidden: a `?mode=planning#plan=…` link stops carrying its plan the moment its recipient
looks at Analytics.

### Two kinds of waypoint

| | |
|---|---|
| **POI** | A halt — a labelled pin above the line. It is a **break**: the router may turn around there, and it bounds a leg. |
| **ROUTING** | A shaping hint — a small hollow dot on the line, from mid zoom. It is a **pass-through**: no u-turn, no leg boundary. |

The difference is not presentational, which is the decision the rest of this section falls
out of. A leg therefore runs POI to POI with its shaping points *inside* it, and the leg
cache keys on all of them together. Flipping a waypoint's kind merges or splits a leg and
moves the line, so the dialog doing the flipping says so.

That granularity turned out to be forced anyway. BRouter answers with one geometry per
request and no leg breakdown, so per-leg numbers require per-leg calls whatever the
semantics — the model and the provider agreed without being made to.

The whole plan — line, stops and hints — is drawn in the **accent colour**, and thinner than
a selected track. It borrowed the selection's paint at first, which was wrong twice over.
That colour and weight say *this is the one you mean* among two hundred others, and a plan
has no competition: it is the only route on the map. So the weight was doing no work and
read as shouting, and the voice was a ride's rather than a plan's. The accent has always
meant *interactive, never data*, which is exactly what a plan is — the one thing on this map
you are making rather than reading.

### One dialog does all of it

A map click drops a provisional pin with a small dialog on it; a search result raises the
same dialog in the same place. One commit path, however the place was found. The pin is
transient — it belongs to neither the plan nor the URL — and clicking a waypoint that
already exists reopens that same dialog in an edit state, with rename and remove on it.

Placement is decided there, and differs by kind, because the kinds want different things:

- **ROUTING** always inserts into the nearest leg. "Bend the route here" has nowhere else
  to go, and appending it would mean something else entirely.
- **POI** offers three — split the nearest leg, or become the new start, or the new end.

The **first two waypoints are POIs implicitly**, with no toggle at all: they are the start
and the end, and until they exist there is no leg for a shaping hint to attach to. The
toggle appears with the third click, when the choice finally means something.

Dragging is the same rules under direct manipulation. A marker drags to move it, recomputing
its one or two legs; the **line itself drags out a new ROUTING waypoint**, into the leg it
came from. Both write history with `replace`, so Back steps out of a gesture rather than
through every frame of it — the rule the viewport already follows. Every discrete edit
pushes, which makes Back an undo and means M8 ships no undo stack, having watched one get
designed and cut for tagging in M4.

### The router is an interface

`packages/routing` holds a `Router` and a `Geocoder` and one directory per implementation —
the shape `ActivitySource` has had since M1, in its own package because neither half of the
app is the natural owner. It costs almost nothing to be a package here: core proves the
pattern is a five-line `package.json` pointing at source, and `noEmit` everywhere means
there is no build step to add.

```ts
route(waypoints, profile, signal): Promise<Leg[]>
```

Array in, legs out. **Single versus batched is not an interface question**: an
implementation with multi-via support sends one request, one without loops, and neither is
visible to the caller. A leg cache sits in front, so an edit normally asks for the one or
two legs it invalidated and nothing else.

Elevation is part of what a `Leg` *is*, rather than a second interface to compose.
Implementations whose provider supplies it pass it through; the rest fill it before
returning. The profile view then has no nulls to handle, and `ElevationProfile` is reused
exactly as the detail panel uses it, cursor sync included — that state was already shared.

**BRouter is implementation #1**, at `brouter.de`: keyless, `Access-Control-Allow-Origin: *`,
and the router people who care about bicycles actually use. Its GeoJSON carries three-element
coordinates, so elevation arrives with the geometry, and it reports `filtered ascend`
separately from `plain-ascend` — the filtered figure being the one that agrees with what
Strava says about the same hill, which a naive sum over a DEM does not.

Its wire format also already contains this section's central distinction. In `lonlats`, a
point given a name comes back typed `via` and a bare one comes back `shaping`. So a POI is
sent as `lon,lat,<name>` and a ROUTING point as `lon,lat`, and the mapping is not a mapping
at all. (`,d` requests a beeline, which is spare capacity for a third kind nobody has asked
for.)

The catch is the same one Komoot carries, and is recorded below rather than smoothed over:
one enthusiast's server, with an API documented as "read `ServerHandler.java`". Every fact
in this section was established by reading that source and then calling the endpoint, not
from documentation, because there is none to trust.

### Profiles are the app's words

Five names — `road`, `trekking`, `gravel`, `mtb`, `hiking` — belonging to the app, with each
implementation mapping them to whatever its engine calls them. A shared link keeps meaning
the same thing across an engine swap, which engine-native strings in the fragment would not.

| App | BRouter | Valhalla |
|---|---|---|
| Road | `fastbike` | `bicycle` + `bicycle_type=Road` |
| Trekking | `trekking` | `bicycle` + `bicycle_type=Hybrid` |
| Gravel | `gravel` | `bicycle` + `bicycle_type=Cross` |
| MTB | `mtb` | `bicycle` + `bicycle_type=Mountain` |
| Hiking | `hiking-mountain` | `pedestrian` (`type=foot`) |

That it lands 1:1 on two engines built on different premises is the same evidence M2 got
when Komoot needed no change to `ActivitySource`: the interface is probably cut in the right
place. A `Router` declares which of the five it serves, and the UI greys the rest.

### Searching for a place

Photon, at `photon.komoot.io` — keyless, CORS, and built for type-ahead, which is precisely
what Nominatim's usage policy forbids. Results are biased to the map centre with its
`lat`/`lon` parameters, which decides the case that actually comes up: Vent exists in four
countries and you are looking straight at one of them. About five rows, each carrying the
name and a `city · state · country` line from Photon's own properties, so two places with
one name are told apart before you click rather than after.

Pointing at a result **rings it on the map and flies there**, and grows its placements
inline, so the common case — *that Vent, at the end* — is one gesture from a list rather than
a trip through the pinned dialog. A ring rather than a pin, because it is not part of the
plan yet and drawing it like a stop would say it was. Clicking the row still raises the
dialog, which is the way to a shaping point, a rename, or a look before committing.

The camera waits a sixth of a second before following the pointer. Moving on every hover was
the first attempt and was unreadable — sweeping down five rows dragged the camera through
the first four — and not moving at all was the second, which left *which Vent is that* to a
ring somewhere off screen. A dwell is below noticing when you meant the row and above the
cost when you did not.

The results themselves float **over** the panel rather than sitting in it. In the flow they
shoved the profile pills and the whole list of stops down and let them spring back on the
next keystroke, which is the page moving under a pointer trying to reach a row.

Reverse geocoding is lazy and POI-only. A map click makes a ROUTING point by default, which
wants no name and costs no request; promoting one to POI is what asks Photon what is there,
and the answer is editable afterwards. The gesture people repeat stays free.

### What it costs the server it borrows

Legs route **on drop, not during the drag**. A drag repaints its affected legs as straight
lines to the cursor — instant, and honest about being provisional — and fires the real
request on `dragend`. Search debounces at 250 ms. One request in flight per leg, superseded
ones cancelled through the `AbortSignal` the interface already takes. A drag across a valley
costs one request rather than forty, which is the difference between using a public endpoint
and being the reason it closes.

A leg with no answer yet draws as a **dashed beeline that pulses**, in the plan's own colour
— the only animation in this app, for the only thing in it that is waiting on somebody else.
A spinner would need somewhere to live, and the thing being waited for is already on screen
and already the right shape.

A leg BRouter *cannot* connect draws the same dash and holds still, because a failure that
looks like it is loading is a failure nobody stops waiting for. Its row says why, and the
totals exclude it and declare themselves incomplete. The alternative — silently beelining,
which the wire format would happily do — folds a straight line across a glacier into your
distance with nothing saying so. This is M3.5's rule for an unreadable GPX, unchanged: it
costs itself and it is named.

### Both panels

The list of stops mirrors the leg structure rather than the waypoint array. Each **POI is a
row** — name, distance and ascent — and the ROUTING points inside a leg are **inline ticks on
the connector** between two rows, reorderable but not competing for attention. A plan with
fifteen shaping points and two real places reads as the trip it is: *Hut · 12.4 km · 640 m up*.

Those numbers are measured **from whichever row is under the pointer**, and from the first
stop when none is. *How far is the hut from here* is what a list of stops is usually being
asked, and *here* is rarely the beginning. They are differences of cumulative figures, so a
stop behind the one you are pointing at reads negative on both — that far back, and that much
less climbing done by then — and the row being measured from carries no numbers at all, which
is what the first row always did.

The panel's top half reuses the single-activity view, by extraction rather than by pretence:
the title block, the stat grid and the elevation profile come out of `DetailPanel` into a
piece both modes render. A plan gets a name, four tiles — distance, ascent, descent,
estimated time — and the profile. No tags and no date, because it was never ridden; the
engine and profile sit where the source badge does. Building a synthetic `ActivityDetail` to
reuse the component untouched was considered and rejected: it fabricates a `startedAt` and a
`source` for something that has neither, and grows `if (isPlan)` branches anyway.

Under it, in the same scroll, sit the things that *change* a plan: the search field, the
profile pills and the list of stops. Outputs above, inputs below — the order the activity
detail already uses, where the tags you edit sit under the numbers you read.

The **filter sidebar stays put in every mode**, and only the right panel changes. It was
briefly the other way round — the waypoint list took the sidebar's side — which meant both
panels changed at once and the filter was reduced to chips in the top bar. Left where it is,
the sidebar is still doing something while you plan: the tracks a plan is drawn over are the
ones it narrowed, and narrowing them is most of the reason to plan on this map rather than
in Komoot. A selected activity is shadowed the same way: `activity=` is left alone and the
right panel just shows the plan instead. Planning shadows the other modes' state; only its
own is destroyed by leaving.

The map chrome follows the mode too. *Fit everything* frames the **whole route** rather than
the extent of the activities — the plan is what you are looking at, and the tracks behind it
are context you dimmed on purpose — over the waypoints *and* the drawn line, because a route
can bulge outside the box its stops make and a hint outside every leg is still on screen. The
grouping toggle is gone entirely: the tracks underneath are inert, and a donut you cannot
click is a control that lies.

The camera fits the plan **once, on first load**, padded past both panels — the same
opening-fit-then-never-again rule the `bbox` filter settled on, for the same reason. A
`?mode=planning#plan=…` link that opened on the wrong continent would be reported as broken
before anything else about it. Panning keeps writing `bbox`, because the tracks underneath
are still filtered by it and that mechanism must not fork per mode.

### Tested at two levels

Recorded BRouter and Photon responses replayed through msw for the adapters — M2's treatment
of Komoot, and the thing that fails with a diff on the day a payload shifts rather than in
someone's browser. A trivial fake `Router` returning straight lines drives every component
test, because a panel test that needs a fixture to render is a panel test that will be
deleted.

## Reference files

A GPX somebody sent you, dropped on the map while you plan. It draws, with its tracks,
its routes and its waypoints, over your own rides dimmed underneath — and that is the
whole feature. Nothing is routed, nothing is converted, and the plan beside it is
untouched.

The question it answers is the one M8 said planning exists for. *Have I been up that
valley?* is answered by looking; so is *does this club route go where I already went?*
Planning here rather than in Komoot was always about what is underneath the thing you
are drawing, and a foreign route is one more thing worth drawing over it.

**Drag and drop is the whole way in**, with a line in the plan panel's empty state to
say so. The Import dropdown keeps meaning exactly one thing — pull from a service,
write to the server — and this writes nothing, reaches no server, and only makes sense
in one mode. A link was considered and is not offered: every site with a route on it has
a download button, and the alternative to a download is a fetch-anything relay on the
edge, which would put the address of where you are going through the server that the
fragment design exists to keep it away from.

### It is not a plan, and that is the point

The obvious feature is the other one: turn the file into waypoints and let BRouter draw
it, so you can edit it. That was designed in full — a Douglas-Peucker seed, the file's
`<wpt>`s projected onto the track as POIs, one leg per `<trk>`, and a manual *Tighten*
loop measuring every file point against the routed line and inserting at the worst
divergence until the two coincided — and then cut, because the reference alone answers
the question and the rest is a router, a simplifier and a session UI in front of it. The
fit loop is written down under *considered and rejected* rather than thrown away.

What survived from it is one gesture. **Clicking a file's `<wpt>` raises the same
`WaypointDialog` a map click raises**, with the name already filled in, so adopting
somebody's hut or col into your own plan costs one click instead of a click and some
typing. That is M8's own rule — one commit path, however the place was found. The lines
themselves stay inert, like the tracks underneath, because every other click on this map
means *put a waypoint here*.

### A part, not a file

One row per `<trk>` **and** per `<rte>`. The common file has one track and one row, and
a six-day export loads as six rows you dismiss one at a time — *just show me day 3 and
4*. Each row carries a colour dot, the part's name and its distance, and expands to its
elevation profile, which is `ElevationProfile` reused exactly as the activity detail and
the plan use it, cursor synced to the map included.

No ascent figure. Nothing in this app computes ascent from points — every figure comes
from a source or from BRouter's `filtered ascend` — and *self-computed metrics* has been
rejected twice already. Distance is haversine, which has no filtering choice in it to
get wrong.

A `<rte>` is turn instructions rather than a drawing of the road, so it cuts every
corner it comes to. Files that carry a token `<rte>` beside a good `<trk>` therefore show
two rows for one route, which is the stated cost of not deciding for you which one you
meant. The route's own points are drawn on its line, so it reads as sparse rather than
as wrong.

Colours are the palette `colour.ts` already hashes tag values into, so a row's dot is
the legend and re-dropping a file gives the same colour. Full opacity above the dimmed
activities and below the plan. The accent is not borrowed: it has always meant
*interactive, never data*, and a reference is data.

**Leaving planning clears them**, exactly as it clears the plan — the mode owns all its
transient state and destroys it on the way out, which is why there is still no Clear
control anywhere.

### Streamed, and therefore unlimited

The parser moved out of the Strava source into `lib/gpx-parser.ts` and grew: every
`<trk>` and `<rte>` as a part, plus the file's `<wpt>`s. The activity import takes the
first part and is otherwise unchanged.

It also stopped using `DOMParser`, which reverses M3.5 and is worth saying why. Measured
in Firefox on a 100 MB GPX, `parseFromString` blocks the main thread for **7 seconds** —
not slowly but completely: zero frames render, the map cannot pan, and a spinner would
sit frozen mid-animation, because it is synchronous and cannot yield. It leaves a DOM
about twenty times the size of the file. `fast-xml-parser`, the thing it replaced, was
worse on both counts.

`saxes` is fed from the file's own stream, so the text never exists as a string at all.
That is the part that matters: peak memory on the same file went from ~470 MB to ~55 MB,
and what is left is the points themselves. Each chunk boundary is a yield, so frames
keep rendering, progress is real and cancelling is a flag checked in the read loop.

**So there is no size limit.** There was going to be one, and the measurements removed
the reason for it: memory is now flat in file size and linear only in point count, which
is bounded by what ends up on the map. Time still scales, so what a huge file gets
instead of a refusal is a progress readout and a Cancel — which `DOMParser` could not
have offered at any size.

Points are thinned with `simplify`, at the same 10 m every activity is already stored
at. The function moved to `packages/core` to be reachable from both sides. Drawing a
reference at full resolution would give it a fidelity nothing else on the map has, for a
line rendered at screen resolution either way.

A dropped file that is not parseable, not a track file, or has no trackpoints is named
and changes nothing — and in a multi-file drop the good files load and the bad ones are
named, which is M3.5's rule about a bad frame, unchanged.

---

## Stack

```
tracks/
├─ packages/core     # tag grammar · THE filter serialization · the API contract · simplify
├─ packages/server   # schema · timezone · simplifier · Hono REST API · ingest
├─ packages/routing  # the Router & Geocoder interfaces · BRouter · Photon
├─ packages/web      # React · MapLibre · ECharts · ActivitySources
├─ migrations/       # drizzle-kit
├─ fixtures/         # recorded Strava, Komoot, BRouter & Photon responses
└─ data/             # gitignored: tracks.db
```

The sources sit in `packages/web` because only the browser runs them — the same rule that
put the schema and the timezone derivation in `packages/server`. Core gained the import
frame schema, which both sides genuinely do run.

`packages/routing` is the one thing neither rule reaches. Only the browser calls a router
today, so `packages/web` would have been defensible — but a server-proxied implementation is
an explicitly anticipated one, and an interface that would have to move house to admit it is
in the wrong place. It costs a five-line `package.json` and one line of `include` to keep it
out of that argument.

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
| **Driver** | `@libsql/client`, one client for two destinations: `file:` opens the embedded libSQL in-process, an `https:` URL is Bunny Database. It replaced `better-sqlite3` in M7 because a native addon cannot follow the app to an edge runtime — and because keeping both would have meant two code paths that could not share a line, one being synchronous and the other not. |
| **Query layer** | Drizzle for schema, migrations and CRUD; hand-written SQL for spatial queries and aggregations, where query builders are worse than the SQL they generate. |
| **Migrations** | Always generated with an explicit name: `pnpm db:generate --name add-elapsed`. Without `--name`, drizzle-kit invents one like `0000_sharp_lily_hollister`, which tells a future reader nothing. |
| **Node, and Deno** | The toolchain is Node: drizzle-kit + `node:sqlite` is an open bug needing a community patch, and a patched migration toolchain is the wrong place to spend novelty. The *deployment* is Deno, because Edge Scripting is — but it never meets that bug, since `drizzle-kit generate` runs here and the script talks to libSQL over HTTP. |
| **Validation** | Zod, in core, for the filter and every response shape — parsed on the way in *and* on the way out. |
| **Web build** | Vite for the browser, esbuild for the deployment. `pnpm dev` runs the Hono app inside Vite via `@hono/vite-dev-server`, so one command HMRs both sides; `pnpm build` produces `dist/`, inlines it into `packages/edge`, and bundles the two into one file. There is one production server and it is that file — a second entry point existed briefly as `tracks serve`, was deleted in M3.5 for serving a `dist` nothing needed, and came back in M7 when there was somewhere to serve it *to*. |
| **Web state** | No router — the app is one page, and core already parses the query string. A `useUrlState` hook over `useSyncExternalStore` is the whole of it; M8 widened its snapshot from `search` to `search + hash` and added `hashchange` beside `popstate`, which is the entire cost of the plan living in a fragment. TanStack Query keys on the serialized filter, so cache invalidation and the URL are the same fact. |
| **Map** | `maplibre-gl` driven imperatively from a hook. Feature-state hover and a viewport-derived filter are both things a declarative wrapper would be in the way of. |
| **Styling** | CSS Modules over one token file. Three tiers: `styles/tokens.css` holds every colour, radius, shadow and step of the type scale; `components/ui/` holds primitives that each own one visual idea; feature components compose them and contain no raw values. A hex code appears in exactly one file — except the two sets no CSS rule can read, the *colour by* palette and the chart colours, which live in `lib/colour.ts` and `lib/chart-theme.ts` beside their only consumers — mirrored from the token file where a token exists, and simply defined there where none does, as the profile's gradient ramp is. |
| **Fonts & icons** | `@fontsource-variable/manrope` and JetBrains Mono, installed and bundled — a Google Fonts link would make "no data leaves the machine except tile requests" false. Icons are `lucide-react`. |
| **Testing** | Vitest in two projects. `node` covers core, the query layer and ingestion — including that an aborted import leaves the database byte-identical — and stays offline. No longer under a second: signing in really does 600k PBKDF2 rounds, and
the handful of tests that go through `POST /api/session` pay for it on purpose, because a
cheap hash there would prove the wrong thing about the one route that has to be right. `web` (jsdom) covers the components, mounts the whole app against a mocked API, and now owns the sources too, with the msw-replayed Komoot fixtures and a zip built at test time from plain-text fixtures. Browser code is tested where a DOM is. jsdom lacks three things the sources need — `dialog.showModal`, a `Blob` undici will read, and an `AbortSignal` it will accept — so `test-setup.ts` adapts them and says why. `--project node` keeps the fast lane. Map styles are checked against `@maplibre/maplibre-gl-style-spec` — validated *and* evaluated against the features each layer will actually meet, because the expression bugs that matter are legal ones that meet the wrong data. |
| **CLI** | **Retired in M3.5.** `tracks import` was the only way to add activities until the Import button existed, and `tracks serve` the only way to look at them until `pnpm dev` was the single entry point. Both are gone, along with commander. Anything a person does, they now do in the app. |

---

## Going online

| | |
|---|---|
| **Database** | Bunny Database — managed libSQL, one primary in Frankfurt, no replicas |
| **Runtime** | One Edge Scripting script (Deno) serving the browser bundle *and* `/api/*` |
| **Hostname** | `tracks.stho.net`, TLS from Bunny; the zone is already on Bunny DNS |
| **Deploys** | GitHub Actions on push to `main`; migrations first, then the script |
| **Cost** | ~$1/month — the account minimum, not usage |

**Not a container.** Magic Containers would run the Node server and `better-sqlite3`
unchanged, and its persistent volumes would even hold the file. They are per-region and
per-pod, unbacked-up, and the documentation warns a rescaled pod may land on a node without
the volume it had. Renting a machine to keep a file alive is the shape this project spent
M3.5 getting away from.

**One script, not two things.** The 2.9MB of `dist` is inlined into the bundle at build
time, inside a 10MB cap. One artifact and one atomic deploy, so `index.html` can never name
a hash that is not in the same bundle — and no second origin, no CORS, and no change to
`lib/api.ts`, which is same-origin already. Cache headers are hand-rolled: hashed assets
immutable, `index.html` never.

**The driver, and the async that comes with it.** `better-sqlite3` is a native addon and
cannot follow. `@libsql/client` replaces it and is async, so the data layer — queries,
tagging, registry, ingest, and their tests — converts throughout. The unit suites stay on
the embedded client against `:memory:`, parallel and offline; `pnpm dev` points at the
production database over HTTP, which makes every development session the integration test
and leaves no container to run. The risk that buys is stated plainly: a bulk tag write
while experimenting is a real edit to real activities.

**The import stops being one request.** The run-long transaction assumed one long-lived
process, and the one-import-at-a-time lock was a module-level variable — neither survives
an isolate. The browser drives the loop instead: one activity per request, written as a
single `batch()`, which is one round trip and one transaction. "All or nothing" narrows
from the run to the activity, and resume was already free because `selectWanted` asks what
is missing before every run. It deletes the NDJSON progress stream, the second connection
and the lock. An activity of 34,626 points exceeds SQLite's ~32k bind variables, so it
splits into several `INSERT`s *inside* the one batch.

**The limits that shape all of it.**

| | |
|---|---|
| **CPU** | 30s per request |
| **Memory** | 128MB |
| **Subrequests** | **50** — the one that decides the import's shape |
| **Script size** | 10MB, against 2.9MB of assets |
| **Database** | 1GB in public preview. At 5.6 bytes a point on the activity row it holds ~180M points, against 1.02M today; it was ~25M when a point was a row |

**Knowing who you are costs a round trip.** M6's per-user signing key means the middleware
reads the user's row before it can check a signature. Locally that is microseconds; at the
edge it is a second round trip in front of the query the request actually wanted. Accepted
as it stands. Two ways out stay in reserve if a measurement ever argues for them: send the
credential read in the same `batch()` as the query it guards, or cache verified tokens in
isolate memory — the second trades away the immediacy of revocation, which is the property
the read was bought for.

**The cut-over.** The Bunny CLI applies `migrations/` in CI and tracks them in
`__bunny_migrations`; `drizzle-kit generate` stays the authoring step and drizzle's own
migrator survives only for embedded dev and test databases. A one-off script copies
`data/tracks.db` into Bunny — `users` is not copied, so activities land on the account
migration 0004 seeds, which is then renamed and claimed by hand. The DNS record is created
**last**: until it exists there is no hostname on which a passwordless seeded account could
be claimed by anyone else. Afterwards the local file is deleted; a partial pull — activities
older than a cutoff — recreates a local copy when working offline.

**What the deploy taught, which no amount of reading had.** Four things about Bunny were
written down as unknowable from here, and shipping settled three.

| | |
|---|---|
| Does the CLI split drizzle's `--> statement-breakpoint`? | Yes. `0004_users.sql (17 statements)`, `0002 (10 statements)` — the one that mattered most, since 0004 is the migration that must land right the first time. |
| Is a standalone script behind a Pull Zone? | Yes, zone 6500335 — so Shield's per-IP rate limiting stays available as the fallback for the sign-in route. |
| Request body limit? | Still unknown. A 1.7MB activity has not been posted to it yet. |
| Rows scanned, or rows returned? | Still unknown, and still the only line in the bill with any upside. |
| Does an interactive transaction survive the HTTP client? | Yes. The plan assumed batch-only until proven, and kept `db.transaction()` in the three write paths so that the fallback would be `batch()` in three functions rather than a redesign. It was not needed: a tag write holds a Hrana stream open across `BEGIN`, the `UPDATE`, the type GC and `COMMIT`, against Bunny, in production. |

**Three things that were not in the plan and cost an afternoon.** All of them the same
shape: a default that is right for a CDN and wrong for an application.

*A standalone script registers its handler with `BunnySDK.net.http.serve(...)`.* The
default-export-with-`fetch` shape that Cloudflare and Deno Deploy take is not wrong here
so much as inert: the module loads, registers nothing, answers nothing, and Bunny falls
back to something that points at itself — so every request, for every path, is a 508 Loop
Detected that says nothing about why. What found it was deploying a script with no
imports at all and watching it fail identically.

*The pull zone stripped `Set-Cookie`.* `DisableCookies` defaults on, because a response
that carries a cookie is a response a CDN cannot share. Signing in worked and could not
prove it had: the confirming request arrived anonymous, which the sign-in form reports as
the browser having refused the cookie. It had not.

*Nothing under `/api` may be cached, and the app says so itself* rather than trusting a
zone setting, because the failure is not a stale sidebar: every response there is scoped
to whoever asked, so a cache keyed on the URL would hand one person's activities to the
next. Bunny rewrites `no-store` to `no-cache` on the way out, which is its opinion and
still forbids serving one without revalidating.

**What is deliberately absent.** No read replica: read-your-writes is only guaranteed on
the primary, and tagging refetches immediately — the objection is correctness, and a replica
costs $0.004/month. No backup job: Bunny snapshots hourly and on idle, and an hour of
granularity is accepted. No rate limiting on the door: the identifier is unguessable and
PBKDF2 costs an attacker a round trip and the server 300ms, with Bunny Shield available
later as a per-IP rule that needs no code.

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
| **M3** | Map, list and filters | The REST API, the MapLibre map with hillshade and contours, the synced activity list, a read-only activity detail with its elevation profile, and the full filter sidebar with viewport spatial filtering. Lands in three commits — the core split, the backend, the browser. |
| **M3.5** | Import from the UI | The Import dropdown, and with it the end of the CLI. Both sources move into the browser, so Komoot credentials never reach the server and a Strava export is never uploaded; the server becomes a source-agnostic writer whose whole run is one rollback-able transaction. Three commits — the sources, the ingest route, the UI. |
| **M4** | Tagging | Writes, at last — and the milestone that took things away. The registry loses its vocabulary and its colours and stops being administered at all; tagging becomes two controls in the sidebar over the current filter, plus editable chips in the detail panel; title search lands beside them, because finding the untagged by name is where the flow starts. Four commits — the registry, search, the routes, the UI. |
| **M5** | Analytics | The three filter-scoped ECharts views, in a slide-over over the map, and the route that was going to serve them deleted before it was written — the rows the client already holds are the input. Three commits — the aggregations, the panel and its trend, the calendar and the distributions. |
| **M6** | Multi-tenancy | A `users` table, and an owner for every row that has one. `activities` and `tag_types` gain a `user_id`; `Scope` stops being the object that made facets cheap and becomes the boundary that keeps users apart, so a query that forgets whose data it is does not compile — including the by-id routes, which until now took an id and nothing else. Accounts are made by hand and carry no password until a first login sets one, and the identifier is an email address because an unguessable name is what makes that safe, not because anything is ever sent to it. Ids stay integers: a UUID in the trackpoint primary key would double the database to buy nothing. |
| **M7** | Hosted on bunny.net | The move off the laptop. Bunny Database — managed libSQL — as one Frankfurt primary, and one Edge Script serving both the browser bundle and the API at `tracks.stho.net`, applied and deployed from CI. `better-sqlite3` goes, and with it the synchronous data layer; the import becomes one activity per request, one `batch()`, one transaction, which is what finally retires the run-long transaction and the module-level lock that guarded it. |
| **M8** | Planning | A third mode, and the first new *kind* of data since M1 — which took no schema at all. A plan is a fragment in the address bar, so the milestone adds no migration, no route and no server code; `useUrlState` widens from `search` to `search + hash` and that is the whole of the plumbing. `packages/routing` gives the router and the geocoder the treatment `ActivitySource` got in M1, with BRouter and Photon behind them, and the POI/ROUTING split turns out to be BRouter's own `via`/`shaping` distinction wearing different names. Four commits — the interfaces, the mode shell, the map editing, the panels. |
| **M9** | Reference files | A GPX dropped on the map while you plan, drawn with its tracks, its routes and its waypoints over the rides underneath — and nothing else: not routed, not converted, not a plan. The milestone that took the parser apart instead. `DOMParser` goes, because measured on a 100 MB file it blocks the main thread for seven seconds and cannot yield; `saxes` streamed off the file replaces it, which also took peak memory from ~470 MB to ~55 MB and removed the reason for the size limit this was going to need. `simplify` moves to core so a reference is thinned to the same 10 m as everything it is drawn beside. Three commits — the parser, the map and the drop, the panel. |

---

## Considered and rejected

Recorded because the reasoning is worth more than the conclusion — and because a future reader
will otherwise propose all of these again.

| Rejected | Why |
|---|---|
| Uploading the Strava zip | The importer opens `activities.csv` and the files it names; photos and comments are most of the archive and none of the tracks. Reading it in the browser sends tens of megabytes instead of hundreds — and nothing at all on a re-import. |
| Keeping Komoot server-side | Its API sends `Access-Control-Allow-Origin: *` and allows `Authorization` on preflight, so the tab can call it. Leaving it on the server would have meant a password crossing a boundary for no reason, and two wire formats where one does. |
| An import job with an id | Nothing outlives the request, so there is nothing to address. A job id needs a route to discover it after a reload, and a rule for what a job with no watcher means. Still true in M7, for a stronger reason: an isolate does not outlive the request either. |
| SSE for progress | `EventSource` is GET-only, so it could carry neither the credentials nor the payload. The stream had to be a POST response, and once it is, NDJSON needs no framing to explain. **Moot since M7**: there is no progress stream, because there is no run to report on — one request per activity, and the response is the progress. |
| A streamed request body | `duplex: 'half'` is Chromium-only, so the browser buffered every frame — ~25MB on a first import — and posted one Blob. **Moot since M7**: one request per activity needs no streaming at all, and nothing is buffered, because a track is sent as it is read and dropped as it is sent. |
| Multipart frames | Needs a streaming multipart parser to avoid buffering the whole body, for a field nobody has asked for. NDJSON lines were the same idea with no parser; since M7 the body is one activity of plain JSON, and there is nothing to frame. |
| Publishing every known id | `GET .../known` would have the server hand out its whole id set for the client to diff. Inverting it — the client offers, the server picks — puts the selection in one place and does not grow with the database. |
| Rolling back a bad *file* | One unreadable GPX would discard ninety good imports. Rollback is for cancel and crash; a bad frame costs itself and is named in the summary. |
| An undo log | Recording each insert and each row's pre-image to replay backwards, to keep resumability. Bespoke undo machinery that must be exactly right about updates, tag merges and re-added enum values — against `ROLLBACK`, which already is. M7 kept the `ROLLBACK` and shrank what it covers: one activity rather than one run, which is what an isolate can promise. |
| A hand-rolled modal | `<dialog showModal>` gives the focus trap, the inert background and the top layer over the map canvas for free. Its Escape is a preventable event, which is all that stood in the way. |
| Keeping `tracks serve` | With the sources in the browser and `pnpm dev` running both halves, a second entry point existed only to serve a `dist` that nothing else needed. It was right to delete and right to rebuild three milestones later: `packages/edge` serves a `dist` that something finally needs, which is the internet. |
| DuckDB | Columnar storage earns nothing at this scale, and it is single-writer — hostile to interactive tagging. |
| UUIDs for activity ids | Judged when `trackpoints.activity_id` sat in a WITHOUT ROWID primary key across 1.02M rows — 98% of the database at ~42 bytes a row — where a TEXT uuid added ~37MB and roughly doubled the file. That table is gone and the argument with it: an id now appears once per activity, not once per point. Still integers, but the reason is only that nothing wants otherwise. |
| `tag_types` as JSON on `users` | Tempting: a registry belongs to a user, array order replaces `sort`, and deleting a user takes it along. It would move three invariants out of the schema and into code — the type GC from one atomic `DELETE` to a `json_group_array` rebuild, uniqueness to something the code must not get wrong, and a browsable table to one opaque cell. |
| Users as credentials only | One shared dataset with several logins was the cheaper half-step: no owner column, no scope on any query. Rejected because the moment a second person has an account they have their own map, and retrofitting an owner column onto a populated database is the migration you least want to write twice. |
| A global session secret | The obvious design, and one round trip cheaper: sign every cookie with one server secret and never read the user. Rejected for what a per-user key gives instead — a password change revoking that person's sessions and nobody else's, immediately, with no sessions table. The price is a read per request and a database leak becoming sufficient to forge a cookie. |
| A sessions table | Instant revocation and "sign out everywhere", at one round trip on every single request rather than the one the per-user key already costs. |
| Batching the auth read into each handler | libSQL's `batch()` would carry the credential read in the same round trip as the query it guards, for free. It moves auth out of one middleware and into every handler, and runs a scoped query for the user a cookie *claims* to be before the signature is checked. Kept in reserve, not taken up front. |
| A signup route | Invite codes, first-run bootstrap, invite links — all of them are a public write path to rate-limit and a token lifecycle to get right, for a tool whose accounts are counted on one hand. `pnpm user:add` is the whole of it. |
| Magic Containers | Would run the Node server and `better-sqlite3` unchanged. Its persistent volumes are per-region and per-pod, unbacked-up, and may not reattach after a rescale — renting a machine to keep a file alive, which is what M3.5 got away from. |
| A read replica | Read-your-writes is only guaranteed on the primary and tagging refetches immediately, so a replica would occasionally show the tags you just changed away from. It costs $0.004/month; the objection was never price. |
| Strava API (Standard tier) | Requires a paid Strava subscription since June 2026. The free bulk archive gives the same data for a personal tool. |
| FIT parser (`@garmin/fitsdk`) | A real archive contains zero FIT files — only GPX and TCX. Add one if a future export needs it. |
| CSV as sport fallback | Its sport vocabulary is localized to the account language. Two untyped rides are tagged by hand instead. |
| Deno 2 | drizzle-kit has an open bug with `node:sqlite`; the workaround is a third-party patch on core tooling. Unchanged by M7: `drizzle-kit generate` still runs under Node, and Deno only runs the deployed script, which talks to libSQL over HTTP and never sees `node:sqlite`. |
| H3 cell precompute | Deferred with the heatmap. Cells would be derived at import from the same points the track columns are encoded from — or from a `trackpoints` rebuilt out of them, which takes under a second. |
| Point objects on the detail route | 34k `{lat, lon, altitudeM, recordedAt}` objects is 2.65MB for one activity — JSON overhead, not resolution. The same points encoded at precision 6 are lossless and 0.07MB; with altitude alongside, 0.30MB. Timestamps went with it: nothing had ever read them, and they are still in the database. |
| Decoding polylines server-side | Kept the browser codec-free, but meant ~50k JSON coordinate arrays per response: 1.14 MB, and more time in `JSON.stringify` and Zod than in the query. The browser already rebuilt every feature to paint it, so the decode joined a pass that existed. 28.3 ms to 2.6 ms. |
| `trackpoints_spatial` index | 35MB to prune one dimension of two. A cached bbox column with an exact SQL refine is the same answer for 6KB, and faster zoomed in. Adopted in 0002 — an earlier draft rejected the idea when the refine was imagined client-side, in turf. |
| `sport_raw` | Already in the on-disk raw JSON. Duplicating the archive into the DB for a query nobody runs. |
| `local_date` | Derivable from `started_at` + `utc_offset`. Denormalization that can drift, for an index nothing needs. |
| `deleted_upstream` | Undetectable with an incremental sync anyway — a deleted activity is indistinguishable from an unlisted one. |
| `kind` discriminator | Reserved space for planned routes, on the grounds that a nullable column later is trivial. M8 gave planned routes a design and it wanted no column at all — a plan lives in the URL fragment. The cheapest migration remained the one nobody wrote. |
| Self-computed metrics | Segment metrics must be dynamic regardless, so storing whole-activity copies duplicates code that already exists. |
| `sync_runs` / `sync_state` | The full-list-plus-missing-streams strategy makes the database its own sync state. |
| Tags join table | Still no join table for *assignments*: a JSON array with `json_each()` does the job at this size. The registry that arrived in M2.5 holds types, not values, so tags never gained ids. |
| `enum_values` on a type | Shipped in M2.5, removed in M4. A vocabulary an importer is allowed to grow on sight is not a constraint — it is `SELECT DISTINCT` kept in a column by a re-add path, a shrink cascade and a validator branch. The values in use say the same thing and cannot drift. |
| A colour column on a type | Hashed from the name instead, the way value colours always were. One mechanism, and one less field on the form that interrupts tagging. |
| Administering the registry | No create-type screen, no delete, no edit. A type is created with its first tag and deleted with its last, so the registry describes the data instead of being a second copy of it to maintain. |
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
| A hand-rolled SVG profile | Would have kept ECharts out until M5 for one line chart, at the price of two charting idioms in one app and a second thing to maintain. Adopting ECharts a milestone early costs a dependency the design had already accepted. |
| `echarts-for-react` | Maintained, and React 19 is fine — this was close. It wraps init, `setOption`, dispose and a resize observer, which is ~40 lines the platform now mostly provides, and the one interesting behaviour here is `dispatchAction`, reached *through* the wrapper either way. `MapView` had already set the precedent for driving an imperative library from a hook. |
| The div histogram | Flexbox bars were exactly right until the range had to be selected on them. A wash with an edge anywhere but a bucket boundary is not something a row of divs can draw. |
| A slider bar under the histogram | Two controls for one decision, stacked, where the shape you are reading and the thing you are cutting were different objects. The inputs moved onto the bars and nothing else changed — the unbounded-end contract, the non-crossing handles and the keyboard all came along. |
| Snapping bounds to bucket edges | Would make the bars exactly lit or dim by construction, and make the achievable filter values depend on how many buckets a chart happens to draw. Bucket count is a rendering choice; a filter bound is not. |
| Brushing a range on the profile | Segment metrics are anticipated and deliberately absent: which metrics, where they render, and whether the map highlights the brushed stretch are unanswered. The cursor is the interaction this milestone owed. |
| A computed elevation gain beside the profile | A second number, a few percent from the tile directly above it, both correct. The axis labels already give the minimum and the maximum, and *self-computed metrics* was rejected once already. |
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
| Rendering M4/M5 controls inert | A dead button invites a click and answers with a shrug. The layout absorbed the analytics switch when it does something — and the bulk-tag button it was also holding a place for never arrived, because tagging went into the sidebar instead. |
| Multi-select, in M3 and then at all | Selection sets, a selection summary and a clear affordance, deferred to the milestone that would consume them — which then did not. A bulk write targets the filter, and the sidebar was already a precise way of choosing activities. |
| Undo, and confirmation | For a write that names its own count on the control performing it. A one-slot journal of pre-images was drafted and dropped: it is machinery in the write path for a mistake the label is already showing you. |
| A pure hash for colours | Collided `sport:bike` with `sport:hike` in the real data. The hash survives as the *preference*; collisions now probe to the next free slot. |
| Per-value colours in the token file | Nothing in CSS can read them — they are painted into GeoJSON properties and passed as props. A round trip through `getComputedStyle` bought nothing and failed silently, since an empty string is a valid CSS value and an invisible track. |
| *Colour by nothing* | A single-colour map answers no question the list does not answer better. The default is the registry's first type instead. |
| Clusters as a circle layer | A circle layer paints one colour per feature, and a cluster is a mixture. Donut markers over the canvas, tallied by `clusterProperties` inside the clustering worker. |
| A separate cluster-count layer | The donut carries its own number in the middle of the ring. |

| Turning a dropped GPX into an editable plan | Designed in full before being cut: a Douglas-Peucker seed, the file's `<wpt>`s projected onto the track as POIs, one leg per part, and a manual **Tighten** loop that measured every file point against the routed line, inserted a shaping point at the worst divergence in every stretch off by more than half the worst gap, and so roughly halved the error per press. Nothing reached the fragment until Confirm, which was gated on the resulting URL fitting. Cut because the reference alone answers the question you plan here to ask, and the rest is a router, a simplifier and a session UI in front of it. Reversible: none of it is foreclosed. |
| Re-routing an imported GPX freely | The cheap version of the above — simplify hard, let BRouter draw its own line through the result. It produces a route that is confidently *not* the one in the file, in the file's name. |
| A link, or a Komoot tour URL | A foreign host sends no `Access-Control-Allow-Origin`, so the tab cannot fetch it, and the fix is a fetch-anything relay on the edge — an SSRF surface, and the address of where you are going transiting the server the fragment design keeps it away from. Komoot alone would work, being CORS-open with a client already here. Every site with a route on it has a download button. |
| A row in the Import dropdown | Import means one thing: pull from a service, write to the server. This writes nothing and works in one mode. The empty state of the plan panel says it instead. |
| A byte limit on a dropped file | Written into the design, then measured away. Streamed, peak memory is flat in file size — ~55 MB for a 100 MB GPX, of which the text is ~15 — so what a huge file costs is time, not safety. It gets a progress readout and a Cancel rather than a refusal and a number nobody can justify. |
| Parsing in a Worker | The main thread would do nothing at all: smooth rather than merely responsive, and disposable memory. Measured at 50 ms of hitch against the streamed parser's ~100 ms, for a blob URL, a message protocol, a bundling step and a second place the parser lives. |
| A hand-rolled scanner instead of a parser | Ten times faster again than `saxes`, and no dependency: a `trkpt` is a regular enough shape to find by hand. It is also hand-rolled XML in the module the activity import depends on — its own answer for comments, CDATA, quoting and entities, and a second implementation for TCX, which `saxes` reads with the same code. |
| `<wpt>`s projected onto the track | Wanted by the fit loop, which needed them as leg-bounding POIs on the line. Without it they are drawn where the file puts them, which is where they are. |
| Ascent for a dropped file | The file carries elevations, so it is a sum away. It is also the self-computed metric rejected twice already, and it would sit beside BRouter's `filtered ascend` for the same line and disagree with it. The profile is drawn; no number is claimed. |
| References surviving a mode switch | Planning owns its transient state and destroys it on the way out, which is the rule that means there is no Clear button. A reference is transient state. |

| A `routes` table | The obvious home for a plan, and the one that makes plans nameable, listable and portable between devices. It also wants a migration, a REST surface, a plans list in a UI with nowhere to put one, and an answer to whether the URL then carries an id or the waypoints. Deferred rather than refused — the fragment forecloses none of it. |
| The plan in the query string | One channel instead of two, and no `hashchange` to subscribe to. Rejected for the one thing a fragment does that a query string cannot: never be transmitted. Length was the reason to expect a fight and turned out not to be one — polyline-encoded waypoints are ~6 characters each, against an ~8 KB edge request-line budget. |
| Planned routes as `activities` rows | Reuses polyline, bbox, the detail route and the list wholesale, for the price of putting rides that never happened into every facet, every count and every analytics chart unless every query in the app learns to exclude them. |
| Valhalla as implementation #1 | Genuinely close, and better documented than BRouter by a distance: `break`/`through` in the reference as the exact semantics wanted, elevation inline via `elevation_interval`, and a precision-6 polyline this app already decodes. BRouter won on the thing the app is for — bicycles — and on `filtered ascend`. Valhalla is the natural implementation #2, and the mapping table above is most of it already. |
| OSRM at FOSSGIS | The most reliable of the three public endpoints and the simplest API. No elevation at all, no gravel/MTB/hiking distinction, and no profile tuning: it answers *the fastest way* and nothing else, which is not the question. |
| Routing through the server | Would buy keyed commercial providers without shipping a key to the tab, and one place to cache. Costs an edge subrequest per call and a second wire format between the interface and the provider, to solve a problem no keyless provider has. It stays an implementation of the same interface rather than a different design, which is the point of there being an interface. |
| Routing live during a drag | The route following the cursor is a better feel and is what the slickest planners do. It also aims a request every ~150 ms at one enthusiast's server for the length of every drag. The beeline preview gives the immediacy for nothing. |
| Silently beelining an unroutable leg | BRouter has a first-class beeline, so the failure could just disappear. It would fold a straight line across a glacier into the distance total with nothing saying so. |
| Nominatim | The obvious OSM geocoder, whose usage policy forbids autocomplete — which is exactly what a search field that answers as you type is. |
| Engine-native profile names in the fragment | Nothing to map and nothing to keep in sync; a new BRouter profile would appear in the UI for free. It also couples every shared link to the engine that made it, so swapping engines invalidates all of them. |
| The waypoint list on the left | Shipped first, and reversed after using it. Putting the list where the sidebar was meant *both* panels changed when the mode did, and the filter — still narrowing the tracks a plan is drawn over — was reduced to chips in the top bar. Moving the whole plan into the right panel leaves one side of the map that never moves. |
| A flat waypoint list | One reorderable list, kind shown by an icon. Simpler by every measure except the one that matters: a plan with fifteen shaping points reads as fifteen anonymous rows with the two real places buried among them. |
| A separate `PlanPanel` | Free to diverge — a leg-by-leg breakdown, a surface summary — without the activity view having an opinion. Two panels that look alike and drift apart, which extracting the shared middle prevents outright. |
| Reusing `DetailPanel` with a synthetic activity | Zero new UI code, at the price of fabricating a `startedAt`, a `source` and a tags array for something that was never ridden — and of the component growing `if (isPlan)` branches anyway. |
| The plan in the selection's paint | Shipped first, on the grounds that a plan plays the role that styling was built for. Reversed after looking at it: that colour and weight mean *this one, among many*, and a plan is the only route on the map — so the weight read as shouting and the colour put a plan and a ride in one voice. The accent means interactive rather than data, which is what a plan is. |
| An undo stack for the plan | Designed and cut for tagging in M4, for the same reason: discrete edits push to history, so Back already is it. |
| Seeding a plan from a ride | *Plan something like this* means choosing which of a ride's 34k points become waypoints — a simplification-tuning problem, dropped into a milestone already carrying a router, a geocoder, a dialog and two panels. The dimmed tracks underneath give most of the value by eye, for none of it. |
| GPX export, in M8 | The legs are already coordinates with elevation, so it is a string builder and a Blob whenever it lands — and it does not touch the *no writing back upstream* non-goal, which forbids pushing to Strava and Komoot, not handing you a file. Held back only to keep the milestone to one idea. |

---

## Still undecided

**Two things about Bunny a deploy has not answered yet** — what Edge Scripting's request
body limit is, against a largest activity of 1.7MB of JSON, and whether "rows read" means
rows scanned or rows returned, which is the only line in the bill with any upside. The
other two were settled by shipping and are recorded above.


**Komoot's CORS headers** — the design depends on an undocumented API's incidental
response headers. If `Access-Control-Allow-Origin: *` ever goes away, Komoot import stops
working in the browser and the answer is a thin server-side relay — the credentials would
then transit the server again, though nothing would need to store them. At the edge that
relay has 50 subrequests to spend per request, so it could not pull an account's tours in
one call: it would be one request per tour, driven by the tab, like the import already is.

**BRouter's server, and its undocumented API** — the same bet as Komoot's, taken knowingly a
second time. `brouter.de` is one enthusiast's machine with no published rate limit and no API
reference; everything M8 relies on was established by reading `ServerHandler.java` and
`FormatJson.java` and then calling the endpoint. If it goes away or its format moves, planning
stops working and the answer is Valhalla behind the same interface — which is the entire reason
the interface exists, and the reason the mapping table above was written before it was needed.

**Heatmap implementation** *(unscheduled)* — Two live candidates. An on-the-fly SQL grid —
`GROUP BY round(lat,4), round(lon,4)` — needs no dependency, no precompute, and respects the
active filter for free. Precomputed H3 cells give equal-area hexagons and instant
set-difference queries for "was this new terrain?", at the cost of an import step that is
filter-blind. Nothing in the schema forecloses either. The on-the-fly grid no longer has a table to
scan, though: points live encoded on the activity, so a SQL grid over them would mean
decoding every track per request, or rebuilding a points table to group over — which takes
under a second but is a step, not a free query. That tilts the choice towards precompute,
and the billing question that used to decide it is settled: rows read are rows **scanned**,
so a grid that walked a million points would be charged for a million.

**Backfilling a new derived type** *(M2.5)* — `selectWanted` reports any activity that
already has a stored track as one the browser need not fetch, which is what makes re-import
cheap. So a type added to the registry later does not reach existing rows by re-running the
import; it needs a one-off rewrite — and since M6 a registry belongs to a user, so that
rewrite is one per person, scoped by `user_id`. Not a problem yet: `source:` is handled by
M2.5's own migration.
