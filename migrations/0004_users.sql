--- Rows get an owner.
---
--- `users` is three columns because an account is not a profile: an address to be known
--- by, and a hash that is null exactly once — between the row being made by hand and the
--- first sign-in claiming it. Nothing is ever sent to the address; it identifies, and its
--- being unguessable is what makes claim-on-first-sign-in safe.
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text
);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint

--- The first account, and the one every existing row is about to belong to. Passwordless
--- like any other: it is claimed by signing in, not by a hash written here.
INSERT INTO `users` (`email`) VALUES ('you@example.com');--> statement-breakpoint

--- Both tables are rebuilt rather than altered, and `trackpoints` is copied even though
--- nothing about its own columns changes. That is not tidiness — it is the only order
--- that does not destroy the database.
---
--- `ALTER TABLE ... ADD COLUMN` cannot add a NOT NULL column without a default, and
--- cannot add a REFERENCES clause at all while foreign keys are enforced. So `activities`
--- has to be rebuilt. But dropping it fires `trackpoints`' ON DELETE CASCADE, and the
--- usual escape — `PRAGMA foreign_keys=OFF` — is a no-op inside a transaction, which is
--- exactly where a migration runs. Drizzle's generated version emits that pragma anyway
--- and would have taken 1.02M trackpoints with it.
---
--- What works with enforcement left on is to move the child's reference off the old table
--- first: build both new tables, fill them, and only then drop two tables that nothing
--- points at any more. The renames are what re-aim the child at the parent's final name.
CREATE TABLE `activities_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text,
	`started_at` text NOT NULL,
	`utc_offset` integer NOT NULL,
	`distance_m` real,
	`duration_s` integer,
	`elapsed_s` integer,
	`elevation_gain_m` real,
	`polyline` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`min_lat` real,
	`max_lat` real,
	`min_lon` real,
	`max_lon` real,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `activities_new` (
	`id`, `user_id`, `source`, `external_id`, `title`, `started_at`, `utc_offset`,
	`distance_m`, `duration_s`, `elapsed_s`, `elevation_gain_m`, `polyline`, `tags`,
	`min_lat`, `max_lat`, `min_lon`, `max_lon`)
	SELECT `id`, (SELECT `id` FROM `users` WHERE `email` = 'you@example.com'),
		`source`, `external_id`, `title`, `started_at`, `utc_offset`,
		`distance_m`, `duration_s`, `elapsed_s`, `elevation_gain_m`, `polyline`, `tags`,
		`min_lat`, `max_lat`, `min_lon`, `max_lon`
	FROM `activities`;--> statement-breakpoint

--- Still WITHOUT ROWID, for the reason 0002 gives: the pair is the table's own key and
--- the order every read of a track already walks.
CREATE TABLE `trackpoints_new` (
	`activity_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`altitude_m` real,
	`recorded_at` integer,
	PRIMARY KEY(`activity_id`, `seq`),
	FOREIGN KEY (`activity_id`) REFERENCES `activities_new`(`id`) ON UPDATE no action ON DELETE cascade
) WITHOUT ROWID;--> statement-breakpoint
INSERT INTO `trackpoints_new` (`activity_id`, `seq`, `lat`, `lon`, `altitude_m`, `recorded_at`)
	SELECT `activity_id`, `seq`, `lat`, `lon`, `altitude_m`, `recorded_at` FROM `trackpoints`;--> statement-breakpoint
DROP TABLE `trackpoints`;--> statement-breakpoint
DROP TABLE `activities`;--> statement-breakpoint
ALTER TABLE `activities_new` RENAME TO `activities`;--> statement-breakpoint
ALTER TABLE `trackpoints_new` RENAME TO `trackpoints`;--> statement-breakpoint

--- The owner joins the key. Two people may each import the same Strava ride, and one of
--- them having it must not make it the other's duplicate.
CREATE UNIQUE INDEX `activities_source_external` ON `activities` (`user_id`,`source`,`external_id`);--> statement-breakpoint

--- A registry belongs to a user, so its key does too: `sort` is unique within one sidebar
--- rather than across everybody's.
CREATE TABLE `tag_types_new` (
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`label` text NOT NULL,
	`single_valued` integer NOT NULL,
	`sort` integer NOT NULL,
	PRIMARY KEY(`user_id`, `name`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `tag_types_new` (`user_id`, `name`, `label`, `single_valued`, `sort`)
	SELECT (SELECT `id` FROM `users` WHERE `email` = 'you@example.com'),
		`name`, `label`, `single_valued`, `sort` FROM `tag_types`;--> statement-breakpoint
DROP TABLE `tag_types`;--> statement-breakpoint
ALTER TABLE `tag_types_new` RENAME TO `tag_types`;--> statement-breakpoint
CREATE UNIQUE INDEX `tag_types_user_sort_unique` ON `tag_types` (`user_id`,`sort`);
