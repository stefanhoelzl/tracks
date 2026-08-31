--- A type no longer declares a vocabulary, so `enum_values` goes; nor a colour, which
--- is hashed from the name the same way every value's is. What is left is metadata a
--- value cannot carry for itself.
ALTER TABLE `tag_types` DROP COLUMN `enum_values`;--> statement-breakpoint
ALTER TABLE `tag_types` DROP COLUMN `color`;--> statement-breakpoint
--- A type now lives exactly as long as something carries a tag of it. Enforcing that
--- from the moment the rule exists means an empty database has an empty sidebar rather
--- than three facets nothing has ever used; `sport` and `source` come back from their
--- seeds the next time an import derives one.
DELETE FROM `tag_types` WHERE NOT EXISTS (
	SELECT 1 FROM `activities`, json_each(`activities`.`tags`) AS `t`
	WHERE substr(`t`.`value`, 1, length(`tag_types`.`name`) + 1) = `tag_types`.`name` || ':'
);
