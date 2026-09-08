--- The row-per-point table goes.
---
--- Everything that read it now reads the three columns on `activities`, and the one-off
--- script has filled them for every row that had points. Verified against production
--- before this ran: 203 activities, 0 null columns, 0 length mismatches, 1,045,599 points
--- stored — and on a sample spanning the smallest track (108 points) to the largest
--- (34,626), the stored streams decode byte-exact against the rows they came from.
---
--- 43.1MB of a 43.5MB database, and the shape mattered more than the size: a viewport
--- filter examined 1,046,207 rows in 192ms where it now examines 203 in 1.2ms, and
--- opening one activity read 1,856 rows where it now reads 1. Both measured on the
--- deployed database, not inferred.
---
--- This is the step that cannot be undone by reverting a deploy — but it is not the loss
--- it looks like. The columns hold the same points to the precision the sources report,
--- so the table can be rebuilt from them: 1.02M rows in 0.9s, differing in nothing but
--- coordinates within 5.57cm and altitude within 5cm, against a receiver with 1-3m of
--- error. Querying points in SQL becomes something to rent for a second rather than own
--- for 43MB.
---
--- The pages are freed, not returned: VACUUM cannot run inside a migration's transaction.
--- An existing database reclaims them on the next `VACUUM`.

--- Refuse rather than destroy. If any activity still has points and no geometry, the
--- backfill has not run here — an old snapshot restored, a database rebuilt from a
--- pre-0005 copy — and dropping the table would take the only copy of its tracks with it.
--- The CHECK fails the INSERT, which fails the migration, which leaves everything alone.
---
--- `RAISE()` is trigger-only in SQLite, so a constraint is how a plain statement says no.
CREATE TABLE `_backfill_guard` (`ok` integer NOT NULL CHECK (`ok` = 1));--> statement-breakpoint
INSERT INTO `_backfill_guard` (`ok`)
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `activities` a
		WHERE a.`track_geometry` IS NULL
			AND EXISTS (SELECT 1 FROM `trackpoints` t WHERE t.`activity_id` = a.`id`)
	) THEN 0 ELSE 1 END;--> statement-breakpoint
DROP TABLE `_backfill_guard`;--> statement-breakpoint

DROP TABLE `trackpoints`;