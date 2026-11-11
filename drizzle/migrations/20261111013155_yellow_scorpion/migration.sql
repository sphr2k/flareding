CREATE TABLE `bookmark_tags` (
	`bookmark_id` text NOT NULL,
	`tag_id` text NOT NULL,
	CONSTRAINT `bookmark_tags_pk` PRIMARY KEY(`bookmark_id`, `tag_id`),
	CONSTRAINT `fk_bookmark_tags_bookmark_id_bookmarks_id_fk` FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_bookmark_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY,
	`url` text NOT NULL,
	`url_key` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`is_unread` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bookmark_tag_tag_id_idx` ON `bookmark_tags` (`tag_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookmark_url_key_unique` ON `bookmarks` (`url_key`);--> statement-breakpoint
CREATE INDEX `bookmark_updated_at_idx` ON `bookmarks` (`updated_at`);--> statement-breakpoint
CREATE INDEX `bookmark_archived_unread_idx` ON `bookmarks` (`is_archived`,`is_unread`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tags` (`name`);