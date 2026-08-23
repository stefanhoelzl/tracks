CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
	`tags` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_source_external` ON `activities` (`source`,`external_id`);--> statement-breakpoint
CREATE TABLE `trackpoints` (
	`activity_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`altitude_m` real,
	`recorded_at` integer,
	PRIMARY KEY(`activity_id`, `seq`),
	FOREIGN KEY (`activity_id`) REFERENCES `activities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trackpoints_spatial` ON `trackpoints` (`lat`,`lon`,`activity_id`);