--- The full-resolution track moves onto the activity it belongs to.
---
--- `trackpoints` was 43.1MB of a 43.5MB database — 41 bytes a row to carry about seven
--- of information. Size is the least of it. Opening one activity read 4,438 rows and
--- 470KB off Frankfurt; importing one wrote a row per point, 1.02M of them, on the one
--- metered operation that costs a thousand times more per row than a read. Both become
--- a single row.
---
--- Three columns rather than one blob, holding exactly what `/api/activities/:id` sends:
--- geometry as a precision-6 polyline, altitude and time as delta-coded scalar streams
--- (`packages/core/src/track-codec.ts`). Stored form is wire form, so the read path has
--- no codec left in it, and the bytes stay legible to anything that can read a polyline.
---
--- Nullable, and null on every existing row: this migration only makes room. The rows are
--- filled by a one-off script, and `trackpoints` is dropped in a later migration once
--- they are — so between the two, the detail route reads whichever of the two exists.
---
--- Lossless to the precisions the sources themselves report. Verified over all 1,045,599
--- points: identical count, identical null positions, timestamps exact, coordinates within
--- 5.57cm and altitude within 5cm — against a receiver with 1-3m of error. The transform
--- runs backwards too: rebuilding `trackpoints` from these columns takes 0.9s and differs
--- from the original in nothing but those two figures.

ALTER TABLE `activities` ADD `track_geometry` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `track_altitudes` text;--> statement-breakpoint
ALTER TABLE `activities` ADD `track_times` text;