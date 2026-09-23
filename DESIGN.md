# Tracks — Design Brief

One map for everything you've ridden and walked — pulled from Strava and Komoot,
tagged, filtered and counted on your own machine.

| | |
|---|---|
| **Deployment** | One Edge Script at [tracks.stho.net](https://tracks.stho.net), over Bunny Database |
| **Dataset** | 197 activities (73 Strava, 124 Komoot), 1.02M track points |
| **Stack** | Node 24 · pnpm · libSQL · React · MapLibre · Deno at the edge · Kotlin Multiplatform on the phone |
| **Status** | M1–M15, M18–M20 and M22 complete · M21 half done: the basemap's labels shipped, its water and summits open · M16–M17 planned: the iPhone app's lock screen, battery and release |

---

## Scope

You open it in a browser and sign in, and an account sees its own activities and nobody
else's. That browser can be a phone's, where the app is read-only (*On a phone*). Planning a route needs no account: anybody who opens the site, or a plan link
somebody sent them, gets the planner without signing in. The tool imports them from Strava and Komoot, draws them on a map, lets you tag
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
| **Turn-by-turn navigation** | The phone shows the map, where you are and which way you are facing, and nothing that talks. No instructions, no rerouting prompts, no off-route alarm — a plan you drew yourself is one you can follow by looking. |

Route planning arrived in M8, and took none of the space that had been left for it: a plan
is a fragment in the address bar, not a row. The nullable column stayed unwritten, which is
cheaper than the safest migration there is.

The iPhone app is M10–M17, and M18–M20 after them — M10–M15 and M18–M20 have shipped, and it is described in full
below: a plan made here goes onto
the phone as the link it already is, can be re-planned there with no signal, is ridden on a
heading-up map, and comes back as an activity. It keeps the rules above — nothing is written
upstream, and the only thing it adds to the server is a file that tells iOS which links are
its own.

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
4. It posts them all to `POST /api/import`, which writes them and streams its
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

Nobody signed in still gets something: the planner, which reads no rows and so needs no
account (*Planning — Without an account*). So the form is not a page the app stands behind
but a dialog over it — raised by the top bar's Sign in, or by itself when a request made as
somebody comes back 401. That is the one place a 401 is handled: the session is marked
*lapsed*, and whatever was on screen stays there behind the dialog, because what you were
looking at is still what you want once you are back.

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
`@versatiles/style`'s `colorful` theme, barely held back — a slight wash towards the paper the app is
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

The style moved to `@versatiles/style` 6 in September 2026, because it had to: v6's release took down v5's
`basics` sprite sheet, and with it every POI icon on the web and the phone alike. The screenshot tests could
not see it — they serve a committed copy of every asset — which is the price of never touching the network in
CI, and worth knowing. v6's `osm()` builds a style with no I/O at all, so both tilesets are spelled out in
`colorful.ts` rather than asked of their `tiles.json`, and the phone's copy builds offline. What v6 changed and
this map did not want is set back by hand: a flat map rather than a globe at the world zooms, no sky, the
relief lit from the north-west, and river names every 160 px. What v6 improved is kept: it now draws water
names itself — lakes by size, ditches too — so ours went and only their colour stayed; woodland reads greener
at the overview zooms; and designated streets are drawn from its own bike layers, apart from tracks and service
roads, which it no longer marks and this style does.

The bike network and trails are part of the same washed style: cycleways and anything `bicycle=designated` in the
accent washed towards the paper, and paths, steps and unpaved footways in a trail blaze's red, both from z13, both
thinner than a track, and dotted rather than dashed where unpaved, because a dash is a plan's straight-line leg.
Shortbread has no `bicycle` below z14, so at z13 a trail is grey — red there would turn a shared cycle path green one
zoom in. `washedColorful()` lives in `map/colorful.ts` so the iPhone app draws the identical style, and
`colorful.test.ts` checks every layer's filters against what the tiles carry.

| | |
|---|---|
| **What gets drawn** | A precomputed Douglas–Peucker polyline per activity at ~10 m tolerance, served still encoded by `/api/tracks` and decoded in the browser. All 197 measure 214 KB stored and 0.23 MB on the wire, against 1.14 MB decoded; full-resolution points load only when you open one activity. |
| **Colour** | A *colour by* selector over the values of any registered type, or year — never over types themselves, since a type has one colour and colouring by it would draw every ride, hike and run identically. There is no *nothing*: a single-colour map answers no question the list does not answer better, so the default is the registry's first type. The registry's own `color` is for chips and sidebar group headers, not for tracks. |
| **Hover linking** | Two-way. Hover a list row and its track highlights; hover a track and the list scrolls to it. The rest keep their colour and weight. |
| **Viewport** | Eases to the result bounds once the filter settles — debounced, so dragging a slider fits at the end rather than every frame. It holds still when nothing matches, rather than lurching at empty bounds, and stays put entirely while *filter to this area* is on. |
| **Low zoom** | Start points cluster into **donuts**, split by the same colour-by that paints the tracks — which valley is all hiking and which is half rides, before you zoom in to find out. The client derives the start points from the track payload it already holds, so clustering costs no endpoint. A toggle turns grouping off entirely, and the tracks then never fade: the zoom interpolation existed only to make room for the donuts. |

### Water, summits and the places a ride stops at

Shortbread's `pois` layer exists at z14 only, and has no peaks, saddles, passes, springs or taps at any zoom. Seeing
water across 20–50 km is what a ride needs, and on a phone that is z9, where a screen is 40 km across. So the map has
points of its own: asked of QLever's copy of the planet monthly by `.github/workflows/points.yml`, and cut into two
tilesets on Bunny for the
style to draw beside VersaTiles'. `map/points.ts` is the one declaration of what they carry — every kind, the OSM tags
that select it, and which tileset it goes in — read by the extract to classify, and by the style to filter on.

Only water a ride can drink is in the tiles. A fountain is drinking water by its own tag and is taken unless it says
otherwise; a tap, a water point, a well or a spring is only sometimes drinkable — a cemetery's tap, a caravan's fill
point — and is taken only when it says `drinking_water=yes`: 13k of 41k taps, 10k of 41k water points, 18k of 345k
wells.

The style draws `outdoor` and does not name `town`, since MapLibre Native's offline packs download every source a
style names, read or not. Water is the water's own blue: a dot from z10, the drop from z13, the name from z16. Summits
are glyphs in the contours' ink — a peak as ▲ with its name and height from z11, a pass as )( from z10, since a pass is
what a route crosses, and a saddle from z11 — and a peak with no name waits for z13; where two collide the higher is
drawn. The places a ride stops at are icons in four inks, one per reason to stop, from the zoom it starts mattering at:
huts, a day's destination, in timber brown from z11; camp and caravan sites in forest green from z12; shelters,
toilets and bike shops in slate from z13; viewpoints and picnic tables in violet from z14; each named two zooms after
its icon. Waterfalls, caves, fords and repair stands are in the tiles and not drawn — no icon says them yet. Whatever
is drawn from these tiles is taken off Shortbread's own POI layers, so nothing is drawn twice, and Shortbread's wells
and taps go with it, since only drinkable water is drawn. The points go over the water names and under the place
names: a village wins over a peak, a peak over a stream. `place=locality`, drawn earlier as the closest thing to a
peak name in a schema without peaks, is not drawn any more.

| | |
|---|---|
| **Shape** | Two sparse `z/x/y.pbf` trees at `tiles.tracks.stho.net`: `outdoor` (water, summits, huts, shelters, fords, campsites, viewpoints, bike repair — 21 kinds) stored at z9–11, `town` (lodging, food, shops, fuel, stations — 16 kinds) at z12. One layer, `points`, with `kind`, `name` and `ele`; MVT extent 32768, so a point overzoomed from z11 is 0.4 m out, the basemap's own precision. Only tiles with something in them exist; a missing one is a 404, which MapLibre reads as empty on the web and on the phone, offline packs included. |
| **Why not a file** | A worldwide GeoJSON is ~34 MB gzipped against the 4.6 MB the edge script has left, and MapLibre indexes a GeoJSON source whole in memory, which 2 M points will not survive on a phone. A region-scoped file would be a silent boundary everywhere else. |
| **Why not PMTiles** | MapLibre Native reads `pmtiles://`, but its offline packs do not cache it. Plain `z/x/y` keeps both the packs and, served straight from storage, any code out of the request path. |
| **The extract** | [QLever](https://qlever.dev) holds the OSM planet with every node, way and relation's geometry already assembled as WKT, and one query per kind, generated from `points.ts`, fetches the lot in about fifteen minutes. Cutting the planet ourselves was built first and set aside: a way's coordinates live on its nodes, which a planet file stores before the ways, so on a 95 GB stream that cannot land on a runner's disk it took two full passes — ~45 minutes and 190 GB a month — and still left out relations. Half of all alpine huts, two thirds of shelters and a third of campsites are ways, so shapes are not optional. QLever is a research service that owes us nothing: a failed request fails the run and the map keeps last month's tiles, and a kind that comes back empty — what a change to its schema looks like — fails it too. Its planet is a few weeks old, which for peaks and fountains is no loss. |
| **Serving** | Bunny Storage has no public read and no per-object headers, so it sits behind a pull zone, and everything a response carries is set there: `Cache-Control` of a week (the default was 296 days, which over tiles rewritten in place would have pinned stale ones for most of a year), CORS with `pbf` allowlisted, and an edge rule adding `Content-Encoding: gzip` to the gzipped tiles — without which the web would get bytes it cannot parse while the phone, which inflates tiles itself, worked. |
| **Upload** | Bunny takes one request per tile and throttles the zone, by an amount that varies: the first upload of all 728k tiles held ~200/s at 128 connections and took an hour, a test the same morning got 34/s, and 256 connections collapse to a few per second. A manifest of tile hashes in the zone makes a run send only what changed, and it is written every 50k tiles along the way, so a run cut off by the job's six-hour limit leaves a truthful one behind and the next carries on. How much a month changes — a 50 km z9 tile changes with any edit inside it — the second run's log will say. |

A full run came to 13.4 M points in fifteen minutes of QLever, cut in three more into 728k tiles and 393 MB — 402k
tiles for `outdoor`, 327k for `town`, the largest a 225 KB town tile. Once a style names these tiles the kinds are a
contract with every installed app, whose committed style reaches them by a URL with no version in it: a kind may be
added, and never renamed or removed. Considered and left out: paths and bike lines in our own tiles, which would fix
one attribute at one zoom (z13's grey) with a 53 M-line tileset, and Komoot's Highlights, which are other people's
content with no licence to serve them.

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

The camera still fits itself, to everything matching — which, with an activity open, is that
activity, since opening one is a filter term. What makes that safe is *what the fit is keyed on*.
Every fit ends in a `moveend` that writes the viewport back as the new bbox, so keying on the
filter as a whole would make each fit the cause of the next. The key is the filter **with its bbox
removed** — what you did, not what the map did in response — so a fit's own write cannot retrigger
it and the loop cannot form.

A fit waits for the data that defines it: the facets for the filter it is keyed on. Until they land the key stays unclaimed, so the fit happens when they arrive rather than
never. And `extent` is read as null while a request is in flight, because react-query holds the
previous response as placeholder data and framing the old filter's extent for the new one would
fly the camera somewhere it was never asked to go.

Getting back out by hand is a camera control, not a filter to clear: *zoom out to all activities*
in the map chrome flies to `facets.extent`, the extent of everything matching the filter with its
bbox term dropped. Self-excluded exactly as a facet is, and for the same reason — it answers "where
is the rest of it?", which the viewport-filtered payload cannot, because the viewport is what
removed it. The move then writes the wider viewport back as the new bbox, like any other pan. The
area is never cleared; it is only ever replaced by looking somewhere else. With an activity open
the same button reads *zoom to this activity* and flies to the same number, which is then that
activity's box. It once framed everything matching even then, because the button and the auto-fit
each decided what to frame and only one of them knew about the selection; making the selection a
filter term left one answer for both to read.

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

Beside Import is **Export**, its other half: everything the filter matches, as one GPX with a
`<trk>` per activity — the list, viewport and all, in its order, so with one activity open it is
that one. Import wore the download arrow until then and wears a plus now; two arrows pointing down,
side by side, read as one control twice. There is no dialog, because the chips already say what
goes in: a click saves `tracks-<date>.gpx`, the button counts `37 / 197` while it runs, and a second
click cancels. The file is written in the tab from the detail route, four activities at a time,
for the reason imports are read there — a whole account is a million points against the edge's
128 MB. Each track carries its title, its sport as stored, and per point the position, height and
time; `gpx-writer.ts` is tested by reading its output back with the importer's own parser. All or
nothing: one failed fetch stops the rest and saves no file, because a file that looks complete and
is missing a ride is worse than none. An activity with no track has nothing to write, and is left out.

Picking a source opens a modal — a real `<dialog>`, so the platform supplies the focus trap
and the layer above the map canvas — which moves through the form, the reading, the writing
and a summary. Nothing closes on its own: a run with failures is something to read, and
while a run is going the only way out is Cancel, because the request *is* the import.
Cancelling while reading has sent nothing; cancelling while writing rolls back.

A list row is a coloured bar plus title, distance, elevation, duration and date. The bar follows
the active *colour by* rather than being hardwired to sport, so the list and the map never read as
two different legends. Clicking one opens it — `?activity=123`, a filter term like any other and
ANDed with the rest — and the right panel swaps to the detail while the map narrows to that one
track, drawn at full resolution. Back is the way out; there is no previous and next, since the rest
of the list is exactly what the term removed. Selection is single, and
stays that way: the checkboxes and shift-click ranges were being kept for the bulk-tagging flow,
and that flow turned out not to want them.

The detail carries an **elevation profile** of the track, against distance along it rather than
against time — timestamps are not on the wire, and the wall at km 62 is how the thing is talked
about anyway. Its distances are scaled to land exactly on the service-reported distance, which is
a few tenths of a percent from the summed polyline: two right numbers reading `87.1` and `87.4`
one row apart look like a bug, and spreading the difference keeps every readout agreeing with the
one figure already on screen.

The axis is a scale rather than two readings: three to five gridlines on a round step — 50, 200,
500 m — with the bottom rounded down and the top up, and distance labelled along the foot in round
kilometres. It never spans less than 200 m, snapped out to whichever step it chose: without a floor
a rolling valley loop fills the box exactly as a col does, and the shape is the only thing the chart
is for.

**One bar, and two of them.** A click puts a bar down — hovering previews one — and it reads `km ·
height · gradient` with the distance and climb **done** on its left and **to come** on its right, in
bold and with no words under them: those two are the point of the line they are on, and the bar
between them already says which is which. Dragging across brushes a **range**: two bars,
the track outside them held back, and the stretch between reported as distance, ↑ and ↓. No average
gradient — a mean over a col is a number about nothing. Riding, the split is measured from *you*
rather than from the bar, which is the only place the two readings differ.

**A selected stretch is drawn on the map** over the line held back to 28% either side of it, so the
chart and the map are talking about the same kilometres. It **keeps the line's own colour** and is
picked out by a white border, rather than being repainted: a stretch drawn in ink would answer *which
piece* by destroying the answer to *what is this ride*, which is the colour it is drawn in. The ends
are interpolated rather than snapped to the nearest recorded point, so dragging a bar moves the
highlight instead of stepping it, and `sliceBetween` is shared and fixture-pinned like the rest.

**Drawn by hand rather than charted.** The same picture appears in four places across two platforms,
one of which paints on a Compose canvas; with a chart library on one side only, every gridline and
every gesture was a translation, and the two drifted. So it is an `<svg>` here and a `Canvas` there
over arithmetic both import from `lib/profile.ts` — the axis, the hit test, the range's figures and
the split — mirrored into Kotlin and pinned by `profile.json`. Kotlin compiled to Wasm would have
made that one source rather than two, and was declined: a few hundred lines of arithmetic do not pay
for a JDK in the web's build path and a stdlib in the browser's bundle. ECharts stays where it earns
its keep, which is the analytics charts.

The gestures are each input's own. A mouse hovers, clicks to pin and drags to brush. A finger taps to
put the bar down; a **long press and a drag sweeps a stretch**, and a long press on either of its bars
moves that end. The long press is what claims the gesture from the pager and the sheet the riding
profile sits inside. A double tap used to open a stretch and the next tap closed it: it fired by
accident — tapping twice to move the bar *is* a double tap — and left something that could only be
cleared, never adjusted.

**Every profile takes the bar**: the activity detail, the plan panel, the plan preview, the editor and
both kinds of riding page. Three of them were pictures until they were not, which is the sort of thing
that compiles, passes and is still wrong; `ElevationProfileGestureTest` presses them now. Missing altitude is drawn as missing: a dropout leaves a gap, and a
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

Hovering and selecting look the same, and hovering dims nothing. Opening an activity does not dim
the rest either: it removes it. It used to leave every other track on the map as context, on the
argument that dimming answered "which one is it?" by deleting the context that made the answer
worth having. That held for a highlight and failed for the camera — with the selection beside the
filter rather than in it, *fit everything* framed the whole archive while one ride was open. Once
the activity is a term the map, the counts, the analytics and the extent all say the same thing,
and hover over the list is still where "which one is it?" is answered with the rest in view. It
applies everywhere, the sidebar's counts included: no facet excludes it, so while an activity is
open the sidebar describes that activity, and a tag edit that stops it matching empties the map
while the detail stays open. Painting the selection a fixed near-black threw away the sport
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
until the new ones arrive, so nothing flashes empty mid-drag. The layout is fluid to about 1100 px.
Below that the panels would cover the map. Until M22 the app said so with a notice instead of a
degraded layout; now there are layouts built for narrower screens rather than squeezed into
them (*On a phone*).

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
&sort_key=distance&sort_order=desc&activity=123&colour_by=sport&grouped=0
```

Units in the URL are **SI** — metres, seconds, metres per second — because those are the column
units, so nothing converts on the way in and the boundary has no rounding question. The browser
converts for display, which it must do anyway. `bbox` is GeoJSON order: `minLon,minLat,maxLon,maxLat`.

The URL carries the filters — the open activity among them, as `activity=` — *and* the view state
that changes what you see — `colour_by`, the sort and whether the map groups — but not the camera. The camera auto-fits to the filter, so a bookmark
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
| `POST /api/import` | Takes one activity's frame as JSON, its `source` inside it, and writes it in one `batch()` — one transaction. One request per activity since M7, so the response is the progress |
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

It lives in the fragment, not in the query string and not in a table. A fragment is never
transmitted, so the one piece of state in this app that says where you are *going* stays in
the tab — the same rule that keeps a Komoot password and a Strava archive off the server,
applied to the only new data M8 creates.

It is one store all the same. `useUrlState` had a `snapshot()` of `window.location.search`;
it now returns `search + hash`, subscribes to `hashchange` beside `popstate`, and writes
`pathname?search#hash` in one go. Three parsers over two slices — `parseFilter`, `parseView`,
`parsePlan` — and one `useSyncExternalStore`, which dedupes identical snapshots, so the
double notification a hash write produces costs nothing. There is no second state mechanism,
and no second place to look when the URL disagrees with the screen.

The fragment is itself a `URLSearchParams`: `name`, `profile` (left out when it is
trekking), `at`, `kinds`, and one `poi` per POI. Waypoints encode into `at` with the polyline
codec the app already ships, at about six characters each, and `kinds` is a parallel string of
`p` and `r`. Coordinates were never what makes a plan URL long; names are. Escaping is the
platform's problem, which matters because polyline encoding emits ASCII 63–126 and that range
includes a backslash, which a fragment may not carry raw.

**Leaving the mode clears the plan.** The fragment exists only while `mode=planning`, so there
is no Clear control anywhere — switching away is the clear, and starting fresh is switching
back. Back is the safety net, since a mode switch pushes. The cost is stated rather than
hidden: a `?mode=planning#at=…` link stops carrying its plan the moment its recipient
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
Since M22 it is compact on both platforms: the name, then one row of marks in route order.
It lost its label and its hints, and it stays attached to its waypoint on a phone too
(*On a phone*).

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

Nothing here changed when planning opened to visitors. Their browsers ask brouter.de and
Photon exactly as an account's do, with the same drop-not-drag and the same debounce, and
nothing of ours sits between them. That is accepted as it stands: the link someone was sent
is the traffic it is for.

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

Under it, in the same scroll, sit the things that *change* a plan: the profile pills, the
search field and the list of stops. Outputs above, inputs below — the order the activity
detail already uses, where the tags you edit sit under the numbers you read. The profile comes
first because it reroutes every leg, so it belongs straight under the numbers it produces; the
search comes next, straight over the list it adds to. It was the other way round until M22
found the phone app already in this order, and the two were made one.
A search result's row offers its placements in route order, as the dialog does: Start,
Insert, End.

The **filter sidebar stays put in every mode**, and only the right panel changes. It was
briefly the other way round — the waypoint list took the sidebar's side — which meant both
panels changed at once and the filter was reduced to chips in the top bar. Left where it is,
the sidebar is still doing something while you plan: the tracks a plan is drawn over are the
ones it narrowed, and narrowing them is most of the reason to plan on this map rather than
in Komoot. An open activity is part of that filter, so a plan started from one ride has only
that ride underneath it; the right panel shows the plan instead of its detail, and leaving
planning brings the detail back. Planning shadows the other modes' state; only its own is
destroyed by leaving.

The map chrome follows the mode too. *Fit everything* frames the **whole route** rather than
the extent of the activities — the plan is what you are looking at, and the tracks behind it
are context you dimmed on purpose — over the waypoints *and* the drawn line, because a route
can bulge outside the box its stops make and a hint outside every leg is still on screen. The
grouping toggle is gone entirely: the tracks underneath are inert, and a donut you cannot
click is a control that lies.

The camera fits the plan **once, on first load**, padded past both panels — the same
opening-fit-then-never-again rule the `bbox` filter settled on, for the same reason. A
`?mode=planning#at=…` link that opened on the wrong continent would be reported as broken
before anything else about it. Panning keeps writing `bbox`, because the tracks underneath
are still filtered by it and that mechanism must not fork per mode.

### Without an account

Planning reads nothing of an account's — the plan is the fragment, the legs are brouter.de's,
the names are Photon's — so it is the one mode a visitor can be given whole. A plan link sent
to somebody opens as the plan, and the site's bare address opens as an empty one. That was
the first reason; the second is you, on a machine you have never signed in on.

Signed out, **every address is planning**. The other two modes are made of an account's rows,
so a link to them opens the planner instead, and the address is corrected to say so — which
is what keeps a plan made before signing in in planning afterwards, rather than hidden behind
the mode the URL had been naming all along.

The screen is the planner and nothing that reads rows. The top bar keeps the brand and the
mode switch, with Activities and Analytics in it but unpressable — what signing in would get
you is on the bar you are looking at, rather than behind a door you have to open to find out.
No totals, no chips, no Import or Export; no filter sidebar and not even its rail, since there is
nothing to filter; no tracks underneath. Dropped files still work: they never left the tab.

**Sign in** takes the place of the account, and opens the form as a dialog over the plan.
Signing in leaves you exactly where you were — the same mode, the same fragment — and the
account's half arrives around the plan: the sidebar, your tracks dimmed under it, the other
modes. Signing out is the reverse, and the plan stays.

A session that **lapses mid-visit** is not the same as nobody. The view it was drawing stays
up, stale, with the dialog over it; signing in again asks for all of it afresh and you carry
on. Declining drops to the planner, as nobody, and everything fetched as somebody is removed
on the way. A page loaded with a cookie that has already died cannot tell you from a stranger,
so it opens as the planner and waits for you to ask.

In code the line is a pair of hooks: `usePlanner` holds everything a plan is made with, and
`useLibrary` every read and write made as somebody, switched off while there is nobody to ask
for — so a visitor's only request to us is the one asking who they are.

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

## On a phone

M22. Until then a window narrower than 1100 px got a notice instead of the app. The design
was settled by an interview and a clickable mockup, and then corrected by looking at it on a
phone-sized screen; where building it changed the design, this section says so.

People who open the web on a phone are mostly **visitors**: somebody sent them a plan link or
a share link, and many of them are on Android, or on an iPhone without the app. The rest are
**you, away from a desk**, looking something up in your own rides. Neither of them imports,
tags or edits. So the phone gets everything that reads and nothing that writes rows:

| | |
|---|---|
| **On a phone** | Activities (the filter, the list, a detail and its elevation profile), Planning, Analytics, Share and Export |
| **Not on a phone** | Import, tag editing, bulk tagging |

Planning is on the list even though it edits something: a plan is a fragment in the address
bar, not a row (*The plan is a fragment*), so it writes nothing to the server.

### Two rules the rest follows from

**Responsive, not duplicated.** There is one component per thing, and every layout uses it.
Only the container changes: the list is the same list in a side panel and in the sheet, and
the elevation profile is the same `<svg>` at any width. There is no `MobileDetailPanel` next
to `DetailPanel`. Two copies look alike on the day they are split and drift apart after that,
which is the reason `PlanPanel` was rejected as a separate panel. Layout decisions come from
CSS and one `useLayout()` hook over `matchMedia`. A change of behaviour lands in both layouts
at once. The compact waypoint dialog below is the first example: it was designed for a phone
and replaces the desktop dialog as well.

**The web on a phone behaves like the iPhone app wherever they overlap.** Somebody who opens a
plan link on Android and later installs the app on an iPhone should not have to learn the
editor twice. So the web uses the app's gestures, its compact waypoint dialog, its stop list
with the four marks, and one sheet over a full-bleed map. Where the two differ, the difference
is written down here with its reason. The web has no riding screen, for example, because
riding is the app's job.

### Width decides

| Width | Layout |
|---|---|
| ≥ 1100 px | The desktop, as described under *Filters & UI* |
| 900–1100 px | The desktop layout with one panel open at a time: opening one collapses the other to its rail |
| < 900 px | The phone layout, and read-only |

**Width alone decides the layout and read-only.** A desktop window made narrow is read-only
as well, and an iPad in landscape gets the desktop. Making read-only follow `pointer: coarse`
would describe the device more faithfully, but it adds a second axis that every test would
have to cross with the first. **Gestures are the exception.** They follow the input that
produced each event, as the elevation profile's already do, so a touch laptop at desktop
width still gets long-press shaping.

**The middle band had one more thing to give up.** At 900 px the desktop's top bar did not fit:
the account's address ran off the right edge. Below 1100 px the bar now drops the address and
the hours total, and the mode switch keeps its icons without their words. Each segment is
still named by its tooltip and its accessible name. Sign out, Share, Import and Export stay.
The map's credit steps up over the camera buttons, which it would otherwise overlap.

### One sheet over the map

The map runs full-bleed, as it does on the desktop, and **one bottom sheet** holds what the
right panel holds there. It snaps to three heights: peek, half and full. At full it stops a
gap below the top bar and never covers it, so the chips and ☰ can always be reached. The
top bar is one row high signed out and two rows signed in, and full follows its real height.

The sheet holds only the current mode's content, with no tabs inside it:

| Mode | The sheet | Opens at |
|---|---|---|
| Activities | The list, with the totals in its header. A row opens the detail in its place, with ‹ All activities to go back | Half |
| Analytics | The cards in one column | Full, because the map says little in this mode |
| Planning | The plan panel: the title, tiles, profile, search, profile pills and stops | Peek, because the map is where a plan is made |

Switching modes sets the sheet's height, and after that it stays wherever it is dragged.
**Every camera fit is padded by the sheet's height**, so an opened activity or a whole plan
is framed in the part of the map that can be seen. This is the rule *padded past both panels*
from the desktop, applied to a panel that sits at the bottom. A tap on a track opens its
detail, as a click does on the desktop.

### The top bar and ☰

The first row holds the brand, the name of the current mode and **☰** at the right edge. The
second row holds the **funnel** and then the filter chips, which scroll, and each chip removes
its own term when tapped. The totals move from the bar into the list's header, because a
phone's top bar has no room for three things that change on every filter.

**☰ lists only what can be used right now**, each entry with the icon the desktop bar gives it:

- Signed in: Activities, Analytics and Planning; then Share and Export GPX; then Sign out, in red.
- Signed out: Copy plan link and Sign in, in green. No modes are listed, because Planning is the only one.

The desktop shows the locked modes as disabled buttons, on the grounds that what signing in
would get you should be visible on the bar you are looking at (*Without an account*). On a
phone that argument loses to space. A menu of disabled entries is a list of things you cannot
do, one tap away from anything you can. Signed out, the second row is not drawn at all, since
there is nothing to filter.

### Filters drop down

The funnel opens the **filter sidebar as a drop-down** from the top bar. It covers about two
thirds of the screen, so the tracks below it can be seen narrowing while you choose. The facets
are the sidebar's own, from the same component. They apply live, as on the desktop, so there
is nothing to confirm. The dialog closes with the **×** in its header, with **Show 37
activities** at its foot, or with a tap on the map. The funnel's badge counts the terms in the
filter. The filter is the same one in every mode, just as the sidebar stays put in every mode
on the desktop (*Both panels*).

**The sheet sinks to peek while the filter is down.** At half, the sheet and the drop-down met
in the middle of the screen and no map was left between them, which undid the reason for the
drop-down. The sheet goes back to wherever it was when the filter closes.

### The map's controls

Zoom ± is left out, because on a phone you pinch. **Fit, satellite and grouping** stand in a
column at the right edge, just above the sheet. They move with the sheet and disappear when it
is at full, which is where the app's riding screen keeps its camera and undo (M20). Grouping is
still absent while planning.

### The waypoint dialog, attached to its waypoint

On a phone, the desktop dialog took a third of the screen to offer four choices. It becomes
**compact, on both platforms**: the name and an ×, then **one row of marks in route order:
Start, Stop, Shaping point, End**. Stop and Shaping point appear only once there is a leg to
add them to. Editing shows the name field, then one row with the kind flip and **Remove as a
red Trash2**. The "Add to A → B" label and the hints are removed. Each mark keeps its word as a
tooltip and as its accessible name, which is the rule the glyphs were introduced under (M18).

Compact enough, it **stays attached to its waypoint** on the phone too: the new pin, or the
marker of the stop being edited. It is clamped inside the screen edges, and it hangs below
the pin when the top bar leaves no room above. The sheet does not move. The camera pans only
if the pin would end up under the sheet or the bar.

The app's editor does the same, from the same rules: TracksMap takes a `pinned` card — a place,
what covers the map's edges, and the dialog — and stands it on the place, tail and all, sliding
and flipping it as the web does and bringing the map to a stop opened from under the sheet.
Its dialog lost the one-choice *Add* it offered an empty plan, since its first waypoint is now
added without asking, as the web's is. The riding screen keeps the dialog in the sheet's place:
riding, the controls are under the thumb, and a card on a map that follows you would move.

### Touch

Planning uses **the editor's gestures from the app** (*The plan arrives as the link it
already is*):

- A tap on the map places a point through the one dialog. An empty plan's first tap is its
  start, with no dialog.
- A long press picks up a stop, and only then can it be dragged, so a pinch never moves one.
- **A long press anywhere else drops a shaping point** into the nearest leg, where the finger
  is. A mouse drags one out of the line; a finger is wider than the line, and *bend the route
  here* does not need one to aim at.
- A long press on a stop row picks it up, and the stops it passes ease aside to make room
  where it will land.

The desktop's handlers are `mousedown` only today, which is why they cannot simply be reused.

What the desktop does on hover, a phone does on tap:

- **Stop distances are measured from the tapped row**, or from the first stop when no row is
  tapped. *How far is the hut from here* survives the move to a phone.
- **A tap on the row already being measured from opens its dialog.** A shaping tick carries
  no numbers, so the first tap on one opens its dialog.
- The row's quiet × is gone. Remove is in the dialog. The app's editor dropped its ×, which it
  showed on every row, for the same reason: a delete that can be hit while scrolling a list
  is worse than one a tap further away.
- Hover linking between the list and the map is not replaced. On touch, a tap already selects.

The elevation profile keeps the finger rules it already has: a tap puts the bar down, and a
long press and a drag sweeps a stretch. The empty plan's hint says so in a finger's words —
*Tap the map to start*, *long-press the map* — where a mouse is told to click and drag.

### Made one with the app

Holding the web on a phone against the app's editor found them apart in more places than the
dialog. Each was settled one way, and both now go that way:

| | Now, on both | Came from |
|---|---|---|
| The dialog's marks | Start, Stop, Shaping point, End — the order the route runs | The web |
| Where the dialog is | On its waypoint | The web |
| An empty plan's first tap | Its start, with no dialog | The web |
| A long press off any stop | A shaping point in the nearest leg | The app |
| The editor's sheet | Three detents: header, half, full; a tap on the header steps up | The web, and the app's own riding sheet |
| A stop row's × | None; Remove is in the dialog | The web |
| Profile pills and place search | The pills first, then the search | The app |
| Carrying a stop in the list | The stops it passes make room | The app |

Left apart on purpose:

| | Web | App | Why |
|---|---|---|---|
| Undo | Back | Undo and Redo on the map | On the web every edit pushes to history, so Back already is the undo (M8); buttons would be a second one that disagrees with it |
| The riding stop list's × | — | Kept | Riding, a tap on a row turns the pages rather than opening a dialog, so the × is the list's only way to remove |
| Naming a new stop | The geocoder | The map's own label under the tap | The app has to work with no signal |
| The map's buttons | Fit, satellite, grouping | Camera, following | The web has no rider to follow; the app has no satellite and no grouping |
| Save, Copy, Cancel | — | In the editor's ⋯ menu | A web plan is its address; the app stores plans |

### Still a page

The phone layout **stays in the browser**. The manifest keeps `display: browser`, and there is
no service worker and no offline mode, because offline is the app's premise and the web would
be a second, worse copy of it. `viewport-fit=cover` with safe-area insets keeps the bar and the
sheet clear of the notch and the home indicator. The height is `100dvh`, so Safari's toolbar
does not cover the sheet. Controls do not double-tap zoom.

On an iPhone with the app installed, a planning link still opens in the app through its
universal link, so the web planner on a phone is for everyone else. There is no "open in the
app" prompt while TestFlight is not open to every account (M17).

### In code

| | |
|---|---|
| **`lib/layout.ts`** | `useLayout()`, the one reader of `matchMedia`: `phone`, `narrow` or `wide`. `App` asks it once and decides the rest. CSS media queries write the same two numbers out, `899px` and `1099px`, because a query cannot read a custom property |
| **`ui/Sheet.tsx`** | The sheet: three detents, a handle that drags and flicks, and a tap that steps it. While a finger drags it, the height goes straight to the node and to `--sheet-h`, so the map's controls follow without re-rendering the app. The map hears only where it comes to rest |
| **`AppMenu.tsx`** | ☰. Share opens the desktop's `SharePanel` in a dialog. Copy plan link is `useCopyPlan` and Export is `useExport`, the hooks the desktop's buttons run on. The export belongs to the menu rather than to its popover, so closing the menu does not cancel it |
| **`FilterDrop.tsx`** | The drop-down: a container around the same `FilterSidebar` the desktop docks, given no `onWrite`, so bulk tagging is not there |
| **Unchanged components** | `TopBar` gains a `phone` arrangement rather than a sibling. `AnalyticsPanel` gains `contained` for the sheet. `ActivityList` shows the totals when the bar cannot. `MapChrome` gains its column. `MapView` takes a `top` and a `bottom` inset, so every fit, `flyTo` and pinned dialog keeps to the visible map |
| **Touch in `MapView`** | `touchstart` on a stop or the line arms a 450 ms timer. Moving 8 px first is a pan, and cancels it. Once it fires, the map stops panning and the drag is the mouse's `follow` and `commit`. A drag ends in a click that is swallowed for 500 ms, not by a flag: a finger's gesture may end in no click at all, and a flag left standing would swallow the next real one |

`useLayout()` being the one reader of `matchMedia` is what lets jsdom render the phone layout:
`test-width.ts` answers `max-width` queries against a width a test sets. The tests check that
nothing that writes is on a phone's screen, that the menu holds the modes and actions, that
the filter drops down and closes on Show, that the menu signed out has only the plan's link
and the way in, that a new waypoint's marks are in route order, that the middle band keeps one
panel open, the sheet's detents, and the tap-then-tap on a stop row under a finger. What jsdom
cannot show was looked at in a real browser at 390 × 844, 900 and 1000 px. Playwright was
considered for that and left out (*Considered and rejected*).

It was planned as three steps (visitors, then an account, then the middle band) and shipped
as one, since the steps share every component.

---

## The iPhone app

The web is where a trip is drawn, over everything already ridden. The phone is where it is
ridden, and where it turns out that the pass is closed. So the app does four things and is
designed around the one of them that is hard: **load a plan, re-plan it with no signal — also
halfway up the valley — ride it on a map that turns with you, and upload the ride.**

It is not a navigation app in the sense the word usually carries. There is no turn-by-turn,
no voice, no off-route alarm and no rerouting prompt: the map, your position and the direction
you are facing, and the plan you drew. It is also not a second planner that drifts from the
first — it runs **the same router on the same data**, so a leg re-planned on a hut terrace is
the leg the web would have drawn.

It is M10–M17, and M10–M15 have shipped. What is left is M16, the lock screen, and M17, the
battery measured on a real ride and TestFlight for every account — one milestone until M16 went
looking and found enough in the release to be its own. The design was settled by an interview and three spikes,
`spike/brouter-ios/REPORT.md` (MobiVM against J2ObjC, on branch `brouter-ios-spike`),
`spike/kotlin-brouter/REPORT.md` (BRouter as Kotlin) and `spike/map-stack/REPORT.md` (the map
layer), and then corrected milestone by milestone by what riding it taught. Where a milestone
reversed the design it is said below, and the design that lost is under *Considered and rejected*.
Simulator numbers ran on a GitHub `macos-26` runner — an Apple M1, virtual, three cores; every phone
number on an iPhone SE (2nd gen), A13 and 3 GB, the harder case.

### Offline is the premise, not a mode

**The whole ride works in airplane mode.** Network is needed to get a plan onto the phone and to
upload a ride, and for nothing in between. That one decision is why the router lives on the phone,
why maps are downloaded without being asked for, and why most of this section exists.

What is kept offline is decided by the app, not the rider — there is no region picker and no
Downloads screen:

| | |
|---|---|
| **For every stored plan** | Its bounding box plus 25 km, rounded out to 0.1° — map tiles to z14, elevation, and every `rd5` segment tile the box reaches. The box, not the line: a re-plan that leaves the line is the reason to have routing data at all |
| **Around you** | A 100 km radius at the same detail, re-centred once you have moved 25 km. This is what makes a ride with no plan, or a re-plan that leaves a plan's own area, work offline |
| **Glyphs and sprites** | Stored once and shared by every area, in MapLibre's own database. Glyphs were measured at 92% of a pack's bytes |
| **Satellite** | Never. The phone has no satellite view |

What each area needs is a set, so deleting a plan frees only what nothing else still needs, and a
recorded ride pins nothing. Measured around Garmisch, one area is about **1 GB**: vector ~325 MB,
elevation ~190 MB (z0–12, which is all the server has), `rd5` ~450 MB. Routing needs whole segment
tiles, which is why they dominate, and why every download first asks with a `HEAD` whether the file
exists, has changed, and fits beside a **1 GB reserve** the app leaves free. Below that reserve,
unfinished map packs pause and the plan's row says the phone is full.

Missing data downloads **on any network**, as soon as it is needed — a plan that arrives at a
trailhead should not wait for Wi-Fi. Refreshing waits for Wi-Fi and follows each source's cadence:
`rd5` a week after it was fetched, because brouter.de rebuilds weekly; map packs when VersaTiles
publishes a new planet, which one weekly `HEAD` on `download.versatiles.org/osm.versatiles`
notices by its ETag; elevation never. `rd5` bytes move through an iOS **background URL session**, so
a 250 MB tile finishes while the app is suspended or even ended. A map pack stalled for a minute is
paused and resumed, and an area that moves keeps its old pack until the new one is whole.

**The map downloads are MapLibre offline packs, used exactly as the library ships them.** They open
20 requests at once with the User-Agent `MapLibreNative/1.0`, and neither can be changed — custom
headers are dropped. The plan had been to download gently, at eight and with a name saying who we
are; the library cannot do that, and an on-device throttling proxy or a second downloader writing
MBTiles was judged more machinery than the problem warranted. VersaTiles publishes no usage policy,
and its server's own configuration allows 200 requests a second per address. **The maintainers were
not asked**: for one person's phone it was judged fine. Opening TestFlight to every account in M17
changes that, and the fallback is written down — regional extracts cut from
`download.versatiles.org` and hosted by us. The bundled style is served to MapLibre under
`tracks://`, because a `file://` style never started on the phone.

**brouter.de's routing profiles follow the server, not the app.** The `.brf` files and `lookups.dat`
live in Application Support, seeded from the app and refreshed from brouter.de's `profiles2` weekly
on Wi-Fi, and a file is replaced only if it reads as a profile of the same lookup version. brouter.de
changes profiles without a release — its `hiking-mountain.brf` sets `SAC_access_penalty` to 999 where
v1.7.10 says 9000 — and a phone routing with last year's profile would draw a leg the web does not.

Place search is Photon when there is a signal. Without one, a waypoint is placed on the map and a
POI takes its name from the vector-tile label under it — a hut or a col is already named on the map
you are looking at. There is no offline search index.

### The plan arrives as the link it already is

A plan is its link — `?mode=planning#name=…&at=…&kinds=…&poi=…` — and **the link is the only way
in**: a tracks.stho.net planning link opened on the phone lands in the app through a universal link.
A share sheet and a Paste link button both existed for a while and were removed. No `routes` table is
added, and the fragment still never crosses the server; the one server change is the
`apple-app-site-association` file, which claims `/?mode=planning` for
`E9Z8BADH58.net.stho.tracks`. The grammar is ported to Kotlin as `PlanFragment`, pinned by fixtures
generated from `plan.ts`. A plan can also be started from nothing, with the + on home.

Arriving never starts navigation. The plan is **kept at once** — one JSON file per plan in
Application Support, at the link's precision — and lands in the list, where its legs are routed as
soon as they can be and each is saved as it lands. A plan re-planned on the phone goes back the way
it came, as a link.

**Routing is online first.** While there is a network, a leg is asked of brouter.de exactly as the
web asks it; without one, or when brouter.de does not answer, the phone's own engine routes it over
the `rd5` tiles it holds. A 400 from brouter.de stays a failed leg rather than falling back. M12
shipped routing on the phone only, which made the phone's line differ from the web's by however old
its tiles were and left a freshly arrived plan unrouted until its tiles had landed; M13 reversed it.
A leg with no tiles yet is "no data here", drawn as a still dash and routed the moment its tiles
arrive — never drawn as unroutable.

**Only the legs an edit touches are routed again**, and a newer edit to a leg cancels the route in
flight — the engine stops mid-search. On the phone a long leg takes seconds: about 11 s for 176 km and
25 s for 306 km on a phone already hot from routing, which is why a leg being routed draws as the web's
dashed, pulsing beeline, pulsed by MapLibre's own transition, and why it never holds up the map or the
recording.

The editor is the web's rules with a phone's gestures, and since M22 the web on a phone has the
same ones (*Made one with the app*). A tap places a point through the one dialog, which stands on the
place; **a stop moves only once a long press has picked it up**, so a pinch never drags one; a long
press anywhere else drops a shaping point into the nearest leg, where a mouse on the web drags the
line; a long press on a stop in the list reorders it. Every edit can be undone and redone. The profile
pills, the search and the stop list sit under the numbers, as on the web, on a sheet with three
detents, and Cancel, Copy and Save live in the editor's ⋯ menu.

**Tapping a plan in the list opens it read-only**, with its stops and profile on a sheet. Navigating
it is **Navigate in its ⋯ menu** — in the list and in the plan view, beside Edit, Copy, Share link and
Delete, all as icons. Save overwrites the plan; Copy first keeps the original. Each row carries a 12 dp
offline mark leading its numbers: a cloud when it is kept offline, a ring filling while it downloads, a
grey ring while it waits, and an amber one when the phone is full.

### One router, in Kotlin

The web routes with BRouter at brouter.de, and the phone runs **the same BRouter** — v1.7.10, on the
same `rd5` data and the same profiles, with the same `filtered ascend`. Every alternative on iOS was
measured or argued against that bar:

| | 176 km route, simulator | peak footprint | app size | why not |
|---|---:|---:|---:|---|
| JVM reference (same M1 runner) | 9.3 s | — | — | not on iOS |
| J2ObjC | 42 s | 3.2 GB, growing every route | +43 MB | leaks the routing graph |
| MobiVM | 10.9 s | 107 MB | +7.6 MB | a JVM in the app, one maintainer |
| **Kotlin/Native, via J2K** | **9.4 s** | **76 MB, flat** | **+2.8 MB** | — |

All of them reproduce brouter.de **byte for byte** — geometry, elevations, ascent, cost — on the six
routes the spikes compared, so correctness never decided anything; memory and upkeep did. J2ObjC's
reference counting cannot free a graph that is cyclic by design, which BRouter's node and link graph
is, and the transient garbage waits for an autorelease pool that only drains when the search does.
MobiVM works, and is the written fallback — but its build is not kept alive.

**The routing core is converted with IntelliJ's own J2K, run headless.** There is no command-line J2K,
so a container holds IntelliJ IDEA 2026.2.2 and a one-class plugin — an `ApplicationStarter` that opens
the five Java modules as a project and calls the converter, which is how Meta ran it for its own
migration. The IDE is JetBrains' Apache-2.0 open-source build rather than the unified download: both may
run headless, but only the open-source one may be cached in CI and baked into an image, and it converts
BRouter to the identical tree (`app/docs/j2k-licensing.md`). `convert.sh` does all of it: 101 files in
about two minutes, the same output every time, converted one file at a time in dependency order because
a batch conversion loses the contract between the files it converts together (1,202 compile errors
against 399).

Getting from that output to common Kotlin is **14 scripted fix passes** — 360 hunks for the conversion,
about 40% replacing Java APIs and 60% cleaning up J2K's types, and one more for the routine below — plus
~950 hand-written lines standing in for `java.io` (over Okio), `java.text` and parts of `java.util`, each
tested against the JDK. The Kotlin is committed and never edited by hand: `replay.sh --check` proves the
tree is exactly J2K's output plus the passes. Every pass names its edits and how many it expects, so a
new BRouter release is: run `convert.sh`, `replay.sh`, rebase what no longer applies, `parity/fetch.sh`,
and pass the parity set.

That gate is the design, because J2K is not always right. It produced four bugs that changed behaviour,
and two compiled cleanly: `(int) x` became a cast that throws on every route, and `float += double` became
a narrowing before the addition, which showed up as **one joule** in one column of three routes and
nowhere else. So the parity set is **17 routes**, well past the six that caught it: every profile the app
offers, named and unnamed vias, shaping points, three routes over 250 km through the Alps, and routes
across two tiles. `parity/fetch.sh` asks brouter.de for them one at a time, ten seconds apart, and pins
the tiles and profiles they were answered from. brouter.de rebuilds its tiles weekly, so that snapshot is
published as a release of this repository and checksummed before the tests run — never kept in git.
Parity runs on the JVM and on native Linux in CI.

**One BRouter routine is rewritten, not converted.** `OsmNodesMap.cleanupPeninsulas` walks dead ends
recursively and wraps the walk in `catch (StackOverflowError)`, giving up part-way when it runs too deep.
Kotlin/Native cannot catch one — the app would crash — so pass 06 makes the walk a loop over an explicit
stack: the same visit order, the same unlinking, and no giving up. That is brouter.de's answer only if
brouter.de never gives up, and measured, it does not: the deepest walk on the parity routes is 4,862
levels, none overflows even on a 512 KB stack, and brouter.de runs on the JVM's default of 1 MB. A route
deep enough to overflow brouter.de would come back different from the phone, and would be written down as
an exception.

The rest of what native Kotlin costs is known and accepted: `synchronized` is a no-op, which is fine
because one thread routes and nothing reads the engine while it does; the debug stack sampler and
`RoutingEngine`'s `Thread` superclass are gone; and on Linux it is about 1.9× slower than HotSpot on long
routes while using a sixth of the memory. No garbage-collector setting was worth changing.

**On the phone** all 17 parity routes are byte-identical to brouter.de:

| | cold | peak footprint |
|---|---:|---:|
| 27 km | 1.0 s | 44 MB |
| 176 km | 8.6 s | 67 MB |
| 306 km | 17.3 s | 92 MB |

**Memory is not the risk**: the app never had less than 2 GB left. **Heat is, and it is bounded.** Twenty
176 km routes back to back slowed from 8.2 to 10.9 s, and ten 306 km routes on the phone already hot
settled at 24.9 s — 43% over cold. That is seven minutes of continuous routing, where a re-plan is one
route and then idle, and since M13 it is only ever offline. The whole app, engine included, is a few
megabytes.

### Kotlin Multiplatform, and a desktop that is never shipped

The app is **Kotlin Multiplatform with a Compose Multiplatform UI**. One codebase draws the screens, and it
targets iOS, which is the product, and a JVM desktop app, which is not. There is no Android app.

The desktop app is how the phone gets tested without a phone, or a Mac: it runs the real UI on Linux with a
ride replayed from a GPX file at 1 Hz and a barometer that replays with it, routes with the real engine over
`--segments`, and opens plans with `--link`. Navigating, re-planning, recording and uploading can all be
exercised at a desk, and uploads go only to a `--server` it is given — there is no default, so never
production by accident. That was the argument for Kotlin over Swift: a native Swift app could only ever be
run in a simulator on a Mac. What stays iOS-only is small and at the edges — the Live Activity widget, which
must be Swift; `CLLocationManager` and `CMAltimeter`; the background URL session; the Keychain.

```
app/
├─ shared/      # no Compose: codecs, plans and their store, the offline needs, riding, recording, upload
├─ brouter/     # BRouter's routing core, converted, and its conversion and parity
├─ ui/          # Compose Multiplatform: TracksMap, home, the plan screens, riding, recording, sensors
├─ iosApp/      # the Xcode shell (XcodeGen), the app delegate's hooks, later the Live Activity widget
└─ desktopApp/  # the harness: replayed location and barometer, never shipped
```

`:shared` and `:brouter` stay free of Compose because the map library has no native Linux build and the
parity gate runs natively there; `:ui` builds the iOS framework and exports `:shared`. It is a Gradle project
on JDK 25 inside the pnpm monorepo, and TypeScript and Kotlin meet where they must agree: the plan fragment,
the polyline and scalar codecs, the import frame, the plan-editing rules, BRouter's request and answer,
Photon, `format.ts` and the elevation profile's measurements are ported, and fixtures generated from the
TypeScript check the Kotlin byte for byte — stale fixtures fail `pnpm test`, and a port that disagrees fails
the Kotlin tests. The washed map style and the colour tokens are pinned the same way.

CI has an `app` job (the Kotlin tests and both parity runs, 15 minutes cold and 4 warm), a `ui` job (the
UI tests, screenshot scenes of the real map, and a replayed ride recorded, saved and uploaded to a dev server
on a database made for the run) and an `ios` job that builds the shell on macOS; the web deploys without
waiting for any of them, and `.ship/gates.sh` runs everything that runs on Linux. The minimum is **iOS 18.5**,
because the map library's bundled ICU is built for it. Every Tracks account can sign in; TestFlight for all of
them is M17.

### The map is behind our own interface

The map is **maplibre-compose**, pinned to one version and wrapped in a `TracksMap` composable that speaks
only the app's types — points, legs by state, position fixes, a camera mode, a tap, a gesture. It is the
library most likely to hurt: three breaking releases in five weeks on an experimental binding layer, Beta on
iOS and Alpha on the desktop. Wrapped, an upgrade is one module and a deliberate act. What still leaks through
is behaviour rather than types: setup is process-wide and must run before the first map, pack progress only
moves while a UI is up, and the desktop needs its own window host. The map's credit is a small pill, open once
a launch, then an ⓘ.

The style is VersaTiles' `colorful` washed by **the web's own `washedColorful()`**, run by `pnpm style:app` and
committed into the app as JSON, so web and phone draw one map and a test fails when they drift. Both draw the
bike network — cycleways and anything `bicycle=designated` — in the accent washed towards the paper, and trails
— paths, steps, and footways when unpaved — in a trail blaze's red, from z13, where the tiles first carry them;
unpaved is dotted, never dashed, because a dash is the plan's straight-line leg. Shortbread has no `bicycle`
below z14, so a trail is grey at z13 rather than red one zoom and green the next. Metric only; the app is **light
only** today (see *Still undecided*).

**What is drawn over the basemap is one list too.** The plan, its stops and shaping points, the routing dash, the
stretch picked out on a profile, the cursor, the ride and the facing cone are style-spec layers in the web's
`overlays.ts`, written beside the style as `overlays.json` and checked by the same test. The phone merges them into
the style as it reads it and only feeds their GeoJSON sources by id — a held waypoint or a routed leg is a property
of the feature, not a layer of its own — setting a paint value only where it is live: the pulse, and a line held back
under a picked-out stretch. Before, `TracksMap.kt` carried a hand copy of every width and dash; moving to the list
changed one picture, `riding-range`, where the ride had been drawn over the stretch of plan picked out under it.
Each entry may say who draws it (`metadata.platforms`) — the contours need the web's protocol, the archive and
dropped files are the web's, the ride and the cone the phone's — and what it goes under (`metadata.before`). The
puck stays maplibre-compose's own, for its native motion between fixes.

**Water has names now, and places arrive earlier.** `colorful` draws no water label at all, so a river was an
anonymous blue line however far you followed it — the tiles carry `water_lines_labels` from z12 and streams from
z14, and both are now drawn along the line, repeating about every 160 px, in the water's own blue. Place labels
start where their data starts rather than where the style chose: town at z8, village z10, hamlet z11. And
`place=locality` is drawn for the first time, from z12: it is OSM's named nowhere, and in the Alps it is what
carries Kramer, Predigtstuhl and Kuhflucht — the closest thing to a peak name in a schema that has **no peaks at
any zoom**. Water sources and summits of our own are the open question, and their own milestone.

**The rider is an accent dot with a white rim and a fading blue cone** for where the phone faces, on every map.
It was ink until the rim existed — the dot rides on the plan line, which is the same green — and the rim is what
keeps the two apart, so you are drawn in the app's own colour like everything else you can act on. The camera has
three states behind one button: **heading-up** (GPS course while moving, the compass below about 4 km/h, where
course is noise), **north-up**, and **manual**, which a pan, pinch or rotate switches to and which leaves the map
where it was put; following always returns to its zoom. The button is two glyphs through all three — a compass needle, and
lucide's `navigation` arrow when the map is turning with you — and **it always shows the mode the map is in or would
go into**, so a tap never changes the shape under your thumb, only its colour: manual draws the mode it would resume
in black, and following draws the mode it is in, in green. They are the one place in the set that is **solid and carries no
circle**: a needle and an arrow are shapes rather than outlines of shapes, stroked they read as small empty triangles,
and framed they read as a button rather than as a direction. There is **no tilt**. North-up is a button rather than a
tap on the map so that taps stay free.

**CI renders the real map**, under Xvfb with Mesa's lavapipe in one container, from a committed 3.4 MB tile
fixture and never the network, and screenshot tests compare it. It needs two things said out loud: Skiko blocks
any GL renderer named `llvmpipe` and falls back to software rendering the map refuses, so
`force_gl_renderer=softgl-llvmpipe` overrides it; and the lavapipe ICD is `lvp_icd.json`. The first is a
workaround against a blocklist, and it is written down because the day it stops working will look like a broken
map.

### Riding it

**Navigating a plan starts recording a ride that follows it**, and *Ride* on home starts one with no plan. While
a ride records, waits to be saved, or was found interrupted, **the riding screen is the app**; Continue after the
app was killed brings the navigation back with it. **There is no off-route cue at all**: no banner, no restyled
line, no vibration. You can see that you are not on the line.

**Where you are along the plan is the nearest point on it, with the past as the tie-break.** Where the route
passes within 30 m of you more than once, the pass nearest along to the last match wins, and on a tie the one
ahead. Riding back moves the readouts back, and the next stop is the first one beyond the match. The design had
been forward-only snapping, which never jumps to the way home on an out-and-back — but it also never lets you
turn around, and the first real out-and-back found that. Legs are scaled to the router's own distance and ascent.

The screen is **one sheet over a map at zoom 15**, the rider in the lower third of what the sheet leaves, and the
sheet opens to one of **three detents, each adding below the one before** — nothing already on the screen moves as
it grows, so the number you were reading stays where you left it:

- **Small**, where a ride starts, is one line: speed, average speed over moving time, and the height you are at.
  Most of a ride is map. There are no pages at this size and so nothing to swipe.
- **Medium** keeps that line on top and adds **the pages**: what you have **ridden so far**, then a page per stop
  still ahead, then **the whole trip** — the two questions a swipe is for, with the legs between them. The leg you
  are on is drawn **stop to stop with a bar where you are**, because the climb you are half way up is a climb and
  not the end of one; a leg further ahead starts at a stop you have not reached, so it is **extended back to you**.
  The profile's span is at least 100 m (the editor keeps the web's 200 m), a tap on it shows that place on the map,
  and totals across a leg that is not routed yet show `+`.
- **Large** keeps both and adds **the stops**, over the strip of map it leaves: the editor's own list, searchable,
  reorderable and deletable, and a tap on a row swipes the pages to that leg. A ride with no plan has no list.
- **Pause and Stop are buttons under the profile in the large sheet**, centred, and nowhere else. Under it rather
  than in the header because opening the sheet only ever *adds below* what was already there, which is the whole of
  how the detents work — a control appearing at the top would move the one thing you were reading. Both are
  deliberate acts, and a menu over a map is a tap between a rider and the thing they meant, so stopping a ride costs
  opening the sheet: the price of never stopping one by accident. A PAUSED chip on the map resumes.

**Undo and Redo and the camera sit on the map just above the sheet and ride up with it** — the hand that reaches
them is already down there, and a control at the top of the screen is a stretch on a handlebar. At the large detent
they sit on the strip of map rather than going away.

**There is no *Edit plan* any more.** The large detent is the editor's list, a long press on the map still raises the
detour dialog, and **a tap on a waypoint opens the editor's own dialog** — delete it, or change what it is — while a
tap anywhere else on the riding map still does nothing at all. Every one of those goes through the **one undo stack
the ride has**, which is what makes a stop dropped in the wrong place on a handlebar one tap from being back. A
second way to change a plan was a second place to be while a ride records, and the copy-to-follow it also carried
went with it.

M14 shipped this as a top card of stops and a separate two-page bottom panel, *To finish* and *To next stop*, as
the mockup had it; riding it put both into one sheet with a page per stop. Riding *that* took distance and climb off
the fixed line — the profile's own done/to-come row carries both, measured from where you are — and put the height
you are at in the space, because nothing else said it.

**Re-planning mid-ride is a long press** — a tap on the riding map does nothing, because a tap on a moving map on
a handlebar is a mistake more often than a wish. The long press opens a dialog: **Through** or **Stop** into the
leg you are on, or **End** after the finish. The change is saved over the stored plan at once, routed online
first, pulsing while it routes, and undone without routing again. **Edit plan** opens the full editor over the
ride; **Copy** there makes the ride follow the copy, and the journal records which plan a ride follows, so a
restart does too. **Recording never pauses** for any of it. There is no one-tap *back to route* and no *skip this
stop*: a long press and the editor already are both.

**The screen stays on while a ride records or waits to be saved**, and at no other time, with no toggle; you lock
the phone yourself. Locked, a Live Activity is to show the next stop and the finish and a small heading-up **map
snapshot** redrawn every few seconds — a lock screen can show a picture, not a map. That is M16,
and whether the picture can carry a map at all is the first thing it has to answer: see *Still
undecided*.

### Recording and the upload

Recording is **1 Hz at best accuracy**, every fix within 30 m and every barometer reading kept, into an
**append-only journal** on disk — one file per ride under Application Support, excluded from backups — which is
also the ride's place in the upload queue. It flushes every five seconds and on every change of state; a line
torn by a kill is dropped on read. If iOS kills the app, it reopens offering to continue. Background location is
*When In Use* with the `location` background mode and a background activity session — not *Always*. There is no
auto-pause, because a slow push up a steep ramp looks exactly like a stop; a manual pause exists.

The tally is the app's own. **Distance** counts only while the fix's own speed says moving and the fix is further
from the last counted point than its accuracy; **moving time** is time at 1 km/h or more with no gap over ten
seconds; **climb comes from the barometer** with 3 m of hysteresis, and it counts stairs, deliberately. Altitude is
the barometer anchored to GPS by the median offset between them, rounded to 1 m, and without a barometer the ascent
is left empty. The app sends that gain as `elevationGainM`. That is not the self-computed metric rejected twice
above: for a ride recorded here, the app *is* the service reporting it.

Stop asks **Save ride?** with a sheet already filled in — the plan's name, or the date for a ride with no plan, and
a sport from the plan's profile (road, trekking, gravel and MTB are `sport:bike`, hiking is `sport:hike`), shown as
figures to toggle, with run chosen only by hand. **Continue** on that sheet takes back a Stop pressed by mistake;
the time spent on the sheet counts as a pause. Saved rides upload whenever there is a network, quietly and with
backoff, through the import frame as it is, as **`source: tracks`**: `POST /api/session`, then `select`, then one
`POST /api/import` per ride, and the journal is deleted only once Tracks has the ride. Altitude is rounded to 1 m;
nothing else is shrunk, because a ten-hour ride is under a megabyte and requests of 10 MB are known to go through.

Signing in is the web's: email and password against `POST /api/session`, with the session kept in the Keychain and
sent back as a `Cookie` header written by hand rather than through a cookie jar, so a password change on the web
signs the phone out too — M6's revocation, unchanged. A 401 forgets the session and holds the rides; a warning comes
three days before the thirty. Sign-in and upload status live on home.

The sign-in sheet says **one short sentence per kind of failure** — *No connection to Tracks.*, *Wrong email or
password.*, *Tracks refused that (503).* — and never what the request threw. A library's sentence about a host and
a negative number has no length it cannot be, and on a sheet that had it above the buttons it pushed them off the
bottom of the screen with the keyboard up and no way to scroll to them. The sheet itself answers the other half:
its buttons are pinned along the bottom, whatever is above them scrolls, and it lifts above the keyboard. That is
in the harness rather than in this one sheet, because the waypoint name, the ride title and the place search all
had the same bug waiting.

**Home is the map, centred on you**, under a sheet listing the stored plans newest first — swipe to delete, the +
for a new one — and *Ride*, with Navigate's arrow, for a ride with no plan. There is no GPX export and no Apple Watch
app.

### Battery

**The target is ≤5 %/h in real riding** — screen on, outdoors, auto-brightness — measured in M17. It may not be
reachable: at outdoor brightness the display alone can cost more than that, and the app cannot make sunlight
cheaper. The screen being on only while a ride is recording, and the area around you re-centring only every 25 km,
are already on the cheap side of both.

**What the app itself costs is measured** (`app/docs/BATTERY.md`; how it is measured: `app/docs/PROFILING.md`). The
map was nearly all of it: MapLibre draws at the display's rate whenever anything on the map changes, and a riding map
always had something changing. So the camera steps to each fix instead of gliding, the map draws at most 15 frames a
second unless a finger or a flight is moving it, and the compass is read only by the map, turns it only below walking
pace, and speaks every 5°. That takes **40%** off the app's CPU while navigating. A dimmer riding style and a rarer
lock-screen snapshot are unmeasured; %/h is M17's, on a ride.

---

## Stack

```
tracks/
├─ packages/core     # tag grammar · THE filter serialization · the API contract · simplify
├─ packages/server   # schema · timezone · simplifier · Hono REST API · ingest
├─ packages/routing  # the Router & Geocoder interfaces · BRouter · Photon
├─ packages/web      # React · MapLibre · ECharts · ActivitySources
├─ app/              # Kotlin Multiplatform: the iPhone app, its desktop harness, BRouter in Kotlin
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
| **Language** | TypeScript end to end. Every heavy-geo case that would have justified Python — FIT parsing, segment matching, performance analysis — is an explicit non-goal, and a shared filter package is worth more than a stronger geo ecosystem. The iPhone app is the exception, and a deliberate one: it is Kotlin Multiplatform so that one codebase runs both on iOS and in a Linux desktop harness, and because BRouter converts to Kotlin. TypeScript and Kotlin share only the plan fragment, the codecs and the import frame, pinned together by fixtures. |
| **Driver** | `@libsql/client`, one client for two destinations: `file:` opens the embedded libSQL in-process, an `https:` URL is Bunny Database. It replaced `better-sqlite3` in M7 because a native addon cannot follow the app to an edge runtime — and because keeping both would have meant two code paths that could not share a line, one being synchronous and the other not. |
| **Query layer** | Drizzle for schema, migrations and CRUD; hand-written SQL for spatial queries and aggregations, where query builders are worse than the SQL they generate. |
| **Migrations** | Always generated with an explicit name: `pnpm db:generate --name add-elapsed`. Without `--name`, drizzle-kit invents one like `0000_sharp_lily_hollister`, which tells a future reader nothing. |
| **Node, and Deno** | The toolchain is Node: drizzle-kit + `node:sqlite` is an open bug needing a community patch, and a patched migration toolchain is the wrong place to spend novelty. The *deployment* is Deno, because Edge Scripting is — but it never meets that bug, since `drizzle-kit generate` runs here and the script talks to libSQL over HTTP. |
| **Validation** | Zod, in core, for the filter and every response shape — parsed on the way in *and* on the way out. |
| **Web build** | Vite for the browser, esbuild for the deployment. `pnpm dev` runs the Hono app inside Vite via `@hono/vite-dev-server`, so one command HMRs both sides; `pnpm build` produces `dist/`, inlines it into `packages/edge`, and bundles the two into one file. There is one production server and it is that file — a second entry point existed briefly as `tracks serve`, was deleted in M3.5 for serving a `dist` nothing needed, and came back in M7 when there was somewhere to serve it *to*. |
| **Web state** | No router — the app is one page, and core already parses the query string. A `useUrlState` hook over `useSyncExternalStore` is the whole of it; M8 widened its snapshot from `search` to `search + hash` and added `hashchange` beside `popstate`, which is the entire cost of the plan living in a fragment. TanStack Query keys on the serialized filter, so cache invalidation and the URL are the same fact. |
| **Map** | `maplibre-gl` driven imperatively from a hook. Feature-state hover and a viewport-derived filter are both things a declarative wrapper would be in the way of. |
| **Styling** | CSS Modules over one token file. Three tiers: `styles/tokens.css` holds every colour, radius, shadow and step of the type scale; `components/ui/` holds primitives that each own one visual idea; feature components compose them and contain no raw values. A hex code appears in exactly one file — except the two sets no CSS rule can read, the *colour by* palette and the chart colours, which live in `lib/colour.ts` and `lib/chart-theme.ts` beside their only consumers — mirrored from the token file where a token exists, and simply defined there where none does, as the profile's gradient ramp is. |
| **Fonts & icons** | `@fontsource-variable/manrope` and JetBrains Mono, installed and bundled — a Google Fonts link would make "no data leaves the machine except tile requests" false. Icons are `lucide-react`, 24 px at stroke 2.2, with **nothing drawn behind them** — no disc, no plate — except a circle on the map's own controls, which is part of the glyph and takes its colour. **Colour is meaning, and green is also the primary**: green goes forward and is the thing to press, red takes something away, black is neutral. On the web that holds under the pointer too: hover draws no disc, it turns the glyph the colour of what pressing it does — green, or red for a close, a remove or signing out. A waypoint is one of four marks — `o->` start, `->o` end, `-o-` stop, `o⌒o` shaping — on the type buttons and at the head of every stop-list row, drawn here and in `Icons.kt` from one set of paths; the markers on the map are unchanged, a glyph being a worse pin than a dot. The sports are Phosphor's `person-simple-*` at **bold**, since lucide draws no hiker and no runner — its regular weight is the same outline at 16/256, a hairline beside everything else, where bold's 24/256 is 2.2 on the 24 grid. |
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
| **M10** | The skeleton and the engine | The iPhone app's foundation, and nothing a user sees. `app/` becomes a Kotlin Multiplatform project; `shared` ports the polyline and scalar codecs, the plan fragment and the import frame, pinned by fixtures generated from the TypeScript so drift fails from either side. `app/brouter` is BRouter v1.7.10's core converted by J2K from JetBrains' open-source IntelliJ build plus 14 fix passes, the last making the peninsula walk a loop, with `replay.sh --check` proving the committed tree is exactly that. The parity gate is 17 routes byte-identical to brouter.de on the JVM and native Linux, against a tile snapshot published as a release. A minimal iOS shell routes all 17 byte-identically on an iPhone SE2 — 306 km in 17.3 s at a 92 MB peak, 43% slower when hot. |
| **M11** | The map and the harness | The first screen. A `:ui` Compose Multiplatform module, kept apart so `:shared` and `:brouter` stay free of a library with no native Linux build. `TracksMap` wraps maplibre-compose 0.16.0 behind app types; the style is the web's own washed `colorful`, committed and drift-tested; the rider is an ink dot and the camera follows course or compass, with north-up a button and no tilt. A `Sensors` interface serves a GPX replay with a standard-atmosphere barometer on the desktop and CoreLocation on the phone. The never-shipped desktop harness, and CI screenshots of the real map on lavapipe from a committed tile fixture. JDK 25 throughout. |
| **M12** | Plans | Plans from the web on the phone. A planning link lands by universal link, is kept at once as a JSON file and routes; the edge serves the `apple-app-site-association` file, the programme's only server change. Home lists the plans, a tap opens one read-only, and the editor ports the web's rules and measurements under fixtures from the TypeScript — legs routed as you watch, only the ones an edit touches, cancelled when superseded. Photon online, map labels offline. It shipped routing on the phone only, which M13 reversed. Undo and redo, icon menus and a plan started from nothing followed in their own pull requests. |
| **M13** | Offline data | The whole ride in airplane mode. Each stored plan's box plus 25 km and the 100 km around you, with every `rd5` tile under them; missing data on any network, refreshes on Wi-Fi at each source's cadence, and a 1 GB reserve. `rd5` through an iOS background session, map packs as MapLibre ships them under a `tracks://` style, glyphs shared, a new VersaTiles planet noticed by ETag. brouter.de's profiles follow the server weekly. Routing becomes online first — brouter.de while there is a network, the phone without — and a plan's legs route the moment its tiles land. The VersaTiles maintainers were not asked; see *Still undecided*. |
| **M14** | Riding | The screen you ride with. Navigate in a plan's ⋯ menu starts a recording that follows it, *Ride* one with no plan, and while a ride is on the riding screen is the app. Where you are is the nearest point on the route with the last match as the tie-break — forward-only snapping lost on the first out-and-back. A long press, not a tap, re-plans mid-ride; Edit plan opens the editor over the ride; recording never pauses. The screen stays on only while riding. Riding it reshaped the screen in the next pull request: one collapsing sheet with a page per stop ahead, average speed, controls behind ⋯, a three-state compass, and a Stop that Save ride? can take back. |
| **M15** | Recording and the upload | A ride recorded on the phone lands in Tracks. The append-only journal that is also the upload queue, recording with the phone locked, the barometer, and a tally of distance, moving time and climb. Sign-in through the web's own session route with the cookie in the Keychain, and a queue that uploads saved rides through the unchanged import frame as `source: tracks`. CI records a replayed ride and uploads it to a dev server on every run. Shipped beside M12–M13 rather than after them, because it needed only the sensors and the import route. |
| **M16** | *Planned* — the lock screen | The Live Activity and its picture, fed by the riding screen's own next stop and finish, so nothing is computed twice — and the numbers it needs from the phone: how often iOS lets a Live Activity refresh, and what drawing its picture costs. Re-scoped on the day it started: the battery and the release went to M17, because checking the handoff turned up enough in each to be a milestone. |
| **M17** | *Planned* — battery and the release | The battery target measured on a real ride with the Live Activity running. The map's levers are already pulled and measured on the phone: 40% off the app's CPU (*Battery*). A dimmer riding style and a rarer snapshot follow if the ride says they are needed. Then TestFlight for every account: a signed build's pipeline, a privacy manifest and an encryption declaration, versions from the build settings, distribution signing beside the development signing that puts builds on the phone today, and the VersaTiles question answered before more than one phone downloads packs. |
| **M18** | The icon set, and the door | The first real ride's notes, turned into an icon rule. Nothing is drawn behind an icon — the accent disc goes, and a control floating on the map is framed by a circle that is part of the glyph. Colour is meaning: green goes forward and is the thing to press, red takes something away, black is neutral. A waypoint becomes one of four marks, `o->`, `->o`, `-o-`, `o⌒o`, drawn once and used by both the phone's dialog and the web's, and at the head of every stop-list row. The camera button becomes two filled glyphs with no circle, showing the mode the map is in *or would go into*. The sign-in sheet's buttons stop being pushed off the bottom of the screen by an error as long as whatever the network threw: the fix is in the `Sheet` harness, so the ride title, the waypoint name and the place search get it too, and a failure is now one short sentence per kind. Numbered after M17 because it came from riding the app, not from the plan. |
| **M19** | One elevation profile | The same drawing, the same numbers and the same gestures in the web's activity detail and plan panel, the phone's plan preview, its editor and its riding sheet. The web drops ECharts for this one chart and hand-draws SVG mirroring the Kotlin Canvas, over `lib/profile.ts` — axis choice, hit-testing, range figures, the done/to-come split — mirrored into Kotlin and pinned by `profile.json`. Axes with round steps and gridlines, a bar that reads `km · height · gradient` over a flanking row, and a stretch between two bars that reports distance, ↑ and ↓ and is drawn on the map. Kotlin→Wasm was weighed as the way to have one source instead of two, and declined: a few hundred lines of arithmetic do not pay for a JDK in the web's build path and a stdlib in the browser's bundle. |
| **M20** | The riding sheet | Three detents, each adding below the one before: a line of figures, then the pages, then the stops. The pages become what you have ridden, a page per stop still ahead, and the whole trip — the leg you are on drawn stop to stop with a bar where you are. The large detent is the editor's own stop list, so *Edit plan* goes and with it the copy-to-follow it carried; a tap on a waypoint opens the editor's dialog, and every edit goes through the ride's one undo stack. Undo, redo and the camera move off the top of the screen to sit just above the sheet. Pause and Stop become buttons under the profile at the large detent, and the ⋯ menu goes. Left out: a free ride cannot be given a plan from the sheet, which needs making one and following it rather than a new layout. |
| **M21** | What the map says | Half shipped. River and stream names, which `colorful` drew nowhere at all, placed along the line and repeated; town, village and hamlet labels started at the zoom their data starts at rather than the one the style chose; and `place=locality` drawn for the first time, which in the Alps is what carries Kramer and Kuhflucht. **Open**: water sources and summits, which Shortbread has no POIs below z14 for and no peaks at any zoom, so they need an extract of our own — whether that is one region-scoped GeoJSON or a tileset, what it covers and how it refreshes is its own workspace. |
| **M22** | The web on a phone | Below 900 px the notice gives way to a full-bleed map, one sheet holding the current mode, ☰ for the modes and actions, and the filter as a drop-down from a funnel. It is read-only for an account and the whole planner for a visitor. There is one component per thing, and it behaves like the app wherever the two overlap: the app's long presses, and its compact waypoint dialog, which the desktop takes too. From 900 to 1100 px the desktop keeps one panel open at a time. Planned as three steps (visitors, then an account, then the middle band) and shipped as one. |

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

| Rejected | Why |
|---|---|
| A native Swift app | Where the design started, and it would have been the smoothest iOS app of the options. It can only ever be run on a Mac — every screen, every replayed ride and every screenshot test behind a macOS runner. Kotlin Multiplatform puts the same app in a Linux window. |
| Capacitor over the web code | Reuses the most code and fails at exactly the parts that make a ride work: iOS suspends a WebView's JavaScript in the background, kills its content process under memory pressure, and MapLibre GL JS has no offline pack manager. |
| React Native | Shares the TypeScript, and still needs a native module for background location, offline tiles and the router — the three things that matter. |
| Shared logic with native UIs | SnapSync's shape: Kotlin for the logic, SwiftUI for the screens. Linux would test the logic and never see a screen, which is where a navigation app goes wrong. |
| An Android app | Nobody asked for one. The desktop harness is what Linux needed, and it is not shipped. |
| Valhalla on the phone | Runs on iOS today and was the fallback for most of the design. A leg re-planned with it takes different roads and reports a different ascent than the web beside it, and its tiles are ours to build. |
| J2ObjC | Measured: 42 s for 176 km and a 3.2 GB peak that grows by 144 MB every route, because reference counting never frees BRouter's cyclic graph. A 64-line patch that tore the graph down helped short routes and made long ones worse; an autorelease pool per search step crashed. |
| MobiVM | Measured, and it works: byte parity, 10.9 s and 107 MB for 176 km, +7.6 MB. It puts a JVM in the app, is essentially one maintainer and has no watchOS target, and the Kotlin conversion beat it on every number. Kept as the written fallback, not as a build. |
| GraalVM Native Image through Gluon | Needs Gluon's patched GraalVM, is GPL-2.0, and has no documented way to be a library called from an app. |
| BRouter through WebAssembly or JavaScriptCore | An iOS app gets no JIT, which makes either 10–100× slower. |
| Letting a model translate BRouter | The fastest way to a port, and a different port every time — a new release would mean translating again with nothing to replay. J2K plus scripted passes is the same output every run. |
| Catching the overflow on a 16 MB stack | Kotlin/Native cannot catch `StackOverflowError`. A big enough stack only makes the crash rarer, so the recursion became a loop. |
| Online-only re-planning | Keeps brouter.de as the only router and needs signal to change a plan, which is the moment on a ride when there usually is none. |
| A corridor around the plan | Much smaller than a region, and a re-plan cannot leave it — which is what a closed pass asks for. |
| A region picker and a Downloads screen | The app knows what a plan needs and where you are; a screen for choosing it is a screen for getting it wrong. |
| Wi-Fi-only downloads | A plan loaded at the trailhead would not be offline until the evening. Only refreshes wait for Wi-Fi. |
| Downloading tiles gently ourselves | Eight at a time with a User-Agent that says who we are, through an on-device proxy or a downloader writing MBTiles. MapLibre's packs cannot be throttled, so it means a second tile pipeline, for a courtesy the tile server has not asked for. The maintainers were not asked; see *Still undecided*. |
| Glyphs inside every pack, or bundled in the app | Per pack they were 92% of every download. Bundled, they ship with every update whether a map changed or not. Downloaded once into a shared cache instead. |
| Satellite imagery offline | 10–50× the size of vector tiles for a view nobody navigates by. |
| An offline place index | The map already carries the names of the places you would search for, under your finger. |
| One-tap *back to route* and *skip to next stop* | Both are a long press on the riding map and the editor over the ride, which riding already has. |
| An off-route cue | A banner, a dashed line or a vibration each argue that you took a wrong turn, on a ride where turning off is usually the point. The map shows it. |
| Heading from the compass alone | Where the phone points, which on a handlebar mount is the mount's magnetism and every bump. GPS course while moving, compass when slow. |
| Forward-only snapping | The design's rule: distance along the route only moves ahead, so an out-and-back never jumps you to the way home. It also never lets you turn around, which the first real out-and-back found. The nearest point with the last match as the tie-break keeps the first property and drops the second. |
| Auto-pause | A slow push up a steep ramp looks like a stop, and the metres it drops are the ones that cost the most. |
| An adaptive sampling rate | Rounds the corners off the hairpins it slows down on, and saves bytes rather than battery — GPS at best accuracy costs the same whichever fixes are kept. |
| Ascent from the elevation model, or none | Consistent with the rule against self-computed metrics, and wrong about a ride the barometer measured. For a ride recorded here the app is the reporting service. |
| A device token | Revocable per phone, and a sessions table's worth of lifecycle for a handful of accounts. The cookie and its per-user key already revoke on a password change. |
| A screen-on toggle, or locking by default | Always-on is what a ride on a map wants, and the lock button is already on the phone. |
| A live map on the lock screen | A Live Activity cannot host a map view. A snapshot redrawn every few seconds is what it can hold. |
| Shrinking the upload | Rounding altitude to 0.1 m, sending the scalar encoding, gzipping the body: 950 KB for ten hours became as little as 89 KB. Requests of 10 MB are known to work, so only the altitude is rounded, to 1 m. |
| GPX export from the phone | The ride lands in Tracks, and the plan travels as a link. |
| An Apple Watch app | MobiVM had no watchOS target, and nothing asked for one after it was gone. If one comes it mirrors the phone and routes nothing. |
| The unified IntelliJ download for J2K | What the spike ran. Its terms allow running it headless, but not clearly caching it in CI or baking it into an image, and it is 740 MB larger. JetBrains' Apache-2.0 open-source build of the same version converts BRouter to the identical tree. |
| BRouter v1.7.10's own profiles | brouter.de runs modified ones — `hiking-mountain.brf` sets `SAC_access_penalty` to 999, not 9000 — and the phone has to route the way the web does. |
| The parity tiles in git | Two tiles are 450 MB and brouter.de rebuilds them weekly. A release asset with a checksum pins the snapshot the fixtures were answered from instead. |
| Routing only on the phone | What M12 shipped: one router, offline or not. A freshly arrived plan stayed unrouted until its tiles had downloaded, and online the phone's line differed from the web's by however old its tiles were. Online first gives the web's own answer whenever it can be had. |
| A share sheet and a Paste link button | Both shipped. A plan's link opened on the phone already lands in the app, so they were two more ways into the same place, and Paste read the clipboard. |
| A tap to start a detour | On a moving map on a handlebar, a tap is a bump as often as a wish. A long press is deliberate, and it is already how the editor shapes a line. |
| A tap on a plan starts navigating | The design had it. A tap is how you look at a plan, and starting a recording by looking was the wrong default; Navigate lives in the ⋯ menu. |
| A top card of stops and a separate bottom panel | What M14 shipped: stops on top, *To finish* and *To next stop* below, independent of each other. Two things to swipe for one question. One sheet with a page per stop ahead, the finish last, answers both with the same swipe. |
| Profiles shipped with the app | brouter.de changes profiles without a release, so a phone routing with the bundled files would draw legs the web does not until the next app update. They follow brouter.de weekly instead. |
| Routing tiles along the plan's line only | Smaller, and a re-plan that leaves the line — which is what re-planning is for — would have no data. The plan's box plus 25 km instead. |

| Rejected | Why |
|---|---|
| Map, List and Filters as tabs | Three full-screen views behind a tab bar is the simplest phone layout to build. You never see the list and the map at once, and an opened activity sits on one screen while its track is on another. |
| A fixed split | The map on top at a fixed height and the panel scrolling below. There are no gestures to build, but the map is always small and the panel always cramped, whatever you are doing. |
| Filters \| Activities inside the sheet | Proposed first: a switch at the top of the sheet between the filter and the mode's content. It made the sheet do two jobs, and in Planning and Analytics it was not clear what the second tab should be. A funnel in the top bar keeps the sheet to the one mode. |
| Filters full-screen | More room for histograms, but the tracks narrowing is the reason to filter on a map, and a full-screen dialog hides them. A drop-down leaves a third of the map in view. |
| The waypoint dialog in the sheet | Shipped in no version, and in the mockup for one round. The sheet had to rise to show four icons and the camera had to pan the pin clear of it. Made compact, the dialog fits beside its waypoint, which is where the desktop always had it. |
| Read-only by `pointer: coarse` | More honest about the device: an iPad would be read-only and a narrow desktop window would not. It adds a second axis to every layout test. Width decides alone, and only gestures follow the input. |
| A tablet layout of its own | A third layout between the phone and the desktop, for a device nobody has asked about. The desktop with one panel at a time covers 900–1100 px with no new components. |
| Locked modes in ☰ | The desktop shows them disabled, so that what signing in would get you is on the bar. In a phone's menu they would be three entries you cannot use, next to the one you can. |
| Zoom buttons on a phone | You pinch. |
| An installable PWA, or offline | Standalone loses the address bar, and with it Back and the plan links the planner is made of. Offline is the app's premise, and a second offline copy of it in the browser would be a worse one. |
| Phone copies of components | Two copies look the same on the day they are split and drift apart after that. One component per thing, in whatever container the layout gives it (*Two rules the rest follows from*). |
| Playwright for the phone layout | It would catch CSS regressions that jsdom cannot see, at the cost of a browser in CI. The layout decisions go through one stubbable hook, and a real phone checks what the tests cannot. |

---

## Still undecided

**The phone's open details** *(M22)*:

- **Nothing has run on a real phone yet.** The layouts were looked at in a desktop browser at
  phone size, and the gestures were tested in jsdom. Still unseen:
  - the long presses on the map and in the stop list under a real finger;
  - the sheet's drag and flick;
  - the safe-area insets around a notch;
  - whether Safari's 16 px rule for fields keeps the page from zooming.
- The sheet's exact heights and how dragging it feels.
- Whether 900 px is the right line, which real tablets will settle.
- How the attached waypoint dialog avoids the keyboard while a stop is renamed.
- The elevation profile's last distance label runs into the one before it at a phone's
  width, as it already did in the desktop's 356 px panel. The axis is shared arithmetic with
  the phone app (*Drawn by hand rather than charted*), so it is changed on both or neither.

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

**VersaTiles and offline packs** — the maps are MapLibre offline packs from tiles.versatiles.org, at the 20
parallel requests and the User-Agent MapLibre gives them. VersaTiles publishes no policy either way, and the
maintainers were not asked, because for one person's phone it was judged fine. TestFlight for every account
(M17) makes it more than one phone. If they would rather not, the fallback is regional extracts cut from
`download.versatiles.org` and hosted by us — a pipeline and a bill.

**Whether ≤5 %/h survives the sun** — outdoors, the display alone may cost more than the target,
and nothing the app does changes that. The map's levers are pulled (*Battery*). Whether that is enough, or
whether the target moves, waits for %/h measured on a real ride.

**What the phone still has to say** — M10 answered memory and routing speed on a real phone: an
iPhone SE2 with 3 GB never had less than 2 GB left, and routed 43% slower when hot. Still
unmeasured: garbage-collector pauses, how often iOS lets a Live Activity refresh, what a snapshot
costs, and the peak that crept from 87 to 108 MB over ten 306 km routes back to back. The two the
lock screen needs are M16's; the rest waits for M17 and the ride it is measured on.

**maplibre-compose in CI** — the desktop runtime is Alpha on an experimental binding, and the headless CI render
depends on overriding Skiko's `llvmpipe` blocklist, which Skiko may change. The spike's flat tilt on iOS stopped
mattering when the camera lost its tilt.

**Light only, or dark too** — the design said light or dark follows iOS; M11 shipped light only, and every
milestone since has kept it. Whether dark mode is dropped or becomes work of its own is not decided.

**Whether the lock screen can show a map at all** — the design says a snapshot, redrawn every few
seconds. iOS forbids GPU work in the background, so a MapLibre snapshot taken while the phone is
locked may simply fail, and the picture would fall back to the plan, the ridden track and the rider
drawn on the CPU with no tiles under them — a diagram rather than a map. A short test on the phone
in M16 settles it. Live Activities also end after eight hours and can only be restarted from the
foreground, which a long day outlives; what the lock screen shows afterwards is unanswered.

**What a day on the bars costs** — beyond the display: `Recorder.track` and `TracksMap` rebuild the
whole ridden line every second, which on a six-hour ride is a long line rebuilt 20,000 times, and
`CADisableMinimumFrameDurationOnPhone` lets a ProMotion phone draw the map at 120 Hz for a position
that moves once a second. Both are M17's to measure before they are optimised. Whether the
garbage-collector pauses and the peak memory that crept from 87 to 108 MB over ten long routes are
M16's or M17's has not been said.

**What the release needs that the app has not got** — an upload to App Store Connect wants a
`PrivacyInfo.xcprivacy` (reading free disk space is a declared API), `ITSAppUsesNonExemptEncryption`,
and version numbers taken from the build settings rather than the literal `1.0` and `1` in
`Info.plist`. Signing today is development only: the script that puts a build on the phone does not
make a distribution build. Whether `NSAllowsLocalNetworking` — there for device tests against a LAN
dev server — stays in a TestFlight build is also open.

**The cost of carrying BRouter** — 14 fix passes, one of them a rewritten routine, replayed for
every release with byte parity as the gate. How much of that replays cleanly depends on how much
upstream changes, and nobody knows that until the next release.

**Cartograph Maps 3** — the one app known to run BRouter on iOS, on the watch too, and following
upstream releases. How it does that is not public; nobody has asked.
