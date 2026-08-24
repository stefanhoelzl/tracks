CREATE TABLE `tag_types` (
	`name` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`enum_values` text,
	`single_valued` integer NOT NULL,
	`color` text NOT NULL,
	`sort` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_types_sort_unique` ON `tag_types` (`sort`);--> statement-breakpoint
--- Seed the three types that exist today. `sport` is an enum because its values are
--- a vocabulary; `trip` and `source` are free strings because theirs are open sets —
--- a trip is whatever you name it, and a source is whatever importer wrote the row.
INSERT INTO `tag_types` (`name`, `label`, `enum_values`, `single_valued`, `color`, `sort`) VALUES
	('sport',  'Sport',  '["bike","hike","run"]', 1, '#0A6B48', 1),
	('trip',   'Trip',   NULL,                    1, '#CE7A0C', 2),
	('source', 'Source', NULL,                    1, '#8A9691', 3);
--> statement-breakpoint
--- Existing tags are all auto-derived sports, since nothing else could write one
--- before types existed. Prefix them, splice in `source:` from the column, and sort —
--- leaving your database and a fresh clone byte-identical, with no manual step.
UPDATE `activities` SET `tags` = (
	SELECT json_group_array(`value`) FROM (
		SELECT 'sport:' || `t`.`value` AS `value`
		FROM json_each(`activities`.`tags`) AS `t`
		UNION
		SELECT 'source:' || `activities`.`source`
		ORDER BY 1
	)
);
