--- The viewport filter was answered by a covering index on (lat, lon) over every
--- trackpoint: 35MB, better than a third of the database. A B-tree orders on one
--- dimension, so that index range-scanned a latitude band and then tested longitude row
--- by row — the `lon` half of its key pruned nothing, in all 1.02M entries.
---
--- What replaces it is the aggregate that was missing. Each track's bounding box is
--- cached on its activity, exactly as `polyline` already caches its geometry: an
--- expensive derivation over a track's thousands of points, stored once so the common
--- query never reads them. Four numbers per activity, 6KB in total, against 35MB.
---
--- The filter stays exact. The box only ever narrows — a long point-to-point ride whose
--- box covers a city it merely passed is still eliminated by the point test that follows,
--- which now runs over a handful of activities instead of all of them. Verified identical
--- to the old query across 24 filter combinations, including one-degree slivers chosen to
--- break the approximation.
DROP INDEX `trackpoints_spatial`;--> statement-breakpoint
ALTER TABLE `activities` ADD `min_lat` real;--> statement-breakpoint
ALTER TABLE `activities` ADD `max_lat` real;--> statement-breakpoint
ALTER TABLE `activities` ADD `min_lon` real;--> statement-breakpoint
ALTER TABLE `activities` ADD `max_lon` real;--> statement-breakpoint

--- Backfill what the importer will keep current from here on. An activity with no
--- trackpoints keeps four nulls, and a null fails every comparison, so it is absent from
--- a viewport filter rather than wrongly inside one.
UPDATE `activities` SET
	`min_lat` = (SELECT min(`lat`) FROM `trackpoints` WHERE `activity_id` = `activities`.`id`),
	`max_lat` = (SELECT max(`lat`) FROM `trackpoints` WHERE `activity_id` = `activities`.`id`),
	`min_lon` = (SELECT min(`lon`) FROM `trackpoints` WHERE `activity_id` = `activities`.`id`),
	`max_lon` = (SELECT max(`lon`) FROM `trackpoints` WHERE `activity_id` = `activities`.`id`);--> statement-breakpoint

--- Rebuild trackpoints WITHOUT ROWID.
---
--- `PRIMARY KEY (activity_id, seq)` on a rowid table is not the table's key — it is a
--- second copy of it, a 15.7MB unique index beside a hidden rowid nothing refers to.
--- WITHOUT ROWID makes that pair the table's own key, which is the order every read of a
--- track already wants: `WHERE activity_id = ? ORDER BY seq` becomes a walk of the table
--- itself. Smaller and faster, for a table that is only ever read this way.
---
--- Drizzle cannot express WITHOUT ROWID, so this is hand-written and `schema.ts` carries
--- a note. Nothing regenerates it, because drizzle does not model the property at all.
CREATE TABLE `trackpoints_new` (
	`activity_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`altitude_m` real,
	`recorded_at` integer,
	PRIMARY KEY(`activity_id`, `seq`),
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;--> statement-breakpoint
INSERT INTO `trackpoints_new` (`activity_id`, `seq`, `lat`, `lon`, `altitude_m`, `recorded_at`)
	SELECT `activity_id`, `seq`, `lat`, `lon`, `altitude_m`, `recorded_at` FROM `trackpoints`;--> statement-breakpoint
DROP TABLE `trackpoints`;--> statement-breakpoint

--- The pages the old index and the old table occupied become free, not returned: VACUUM
--- cannot run inside the transaction a migration is applied in. An existing database
--- reclaims them on the next `VACUUM`; one imported from scratch never spends them.
ALTER TABLE `trackpoints_new` RENAME TO `trackpoints`;
