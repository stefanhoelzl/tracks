--- Public links to a filter.
---
--- A row is a token and a query string: the filter is stored rather than the activities
--- it matched, so a link keeps up with what is imported after it was made. The token is
--- the primary key and the whole URL — 128 random bits, the only thing between a
--- stranger and the rows it opens. Revoking is deleting the row; expiry is a date
--- checked on every read, so an expired link can be extended back to life.
---
--- One link per filter per owner, which is what lets the browser ask "is this already
--- shared?" by comparing strings. The owner's cascade takes their links with them.
CREATE TABLE `share_links` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`filter` text NOT NULL,
	`label` text,
	`expires_on` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `share_links_user_filter` ON `share_links` (`user_id`,`filter`);