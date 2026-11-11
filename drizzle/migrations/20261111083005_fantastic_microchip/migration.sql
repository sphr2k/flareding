ALTER TABLE `bookmarks` ADD `shared` integer DEFAULT false NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bookmark_tags` (
	`bookmark_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	CONSTRAINT `bookmark_tags_pk` PRIMARY KEY(`bookmark_id`, `tag_id`),
	CONSTRAINT `fk_bookmark_tags_bookmark_id_bookmarks_id_fk` FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_bookmark_tags_tag_id_tags_id_fk` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_bookmark_tags`(`bookmark_id`, `tag_id`) SELECT `bookmark_id`, `tag_id` FROM `bookmark_tags`;--> statement-breakpoint
DROP TABLE `bookmark_tags`;--> statement-breakpoint
ALTER TABLE `__new_bookmark_tags` RENAME TO `bookmark_tags`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`url` text NOT NULL,
	`url_key` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`is_unread` integer DEFAULT false NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
INSERT INTO `__new_bookmarks`(`id`, `url`, `url_key`, `title`, `description`, `notes`, `is_archived`, `is_unread`, `created_at`, `updated_at`, `metadata`) SELECT `id`, `url`, `url_key`, `title`, `description`, `notes`, `is_archived`, `is_unread`, `created_at`, `updated_at`, `metadata` FROM `bookmarks`;--> statement-breakpoint
DROP TABLE `bookmarks`;--> statement-breakpoint
ALTER TABLE `__new_bookmarks` RENAME TO `bookmarks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_tags`(`id`, `name`) SELECT `id`, `name` FROM `tags`;--> statement-breakpoint
DROP TABLE `tags`;--> statement-breakpoint
ALTER TABLE `__new_tags` RENAME TO `tags`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `bookmark_tag_tag_id_idx` ON `bookmark_tags` (`tag_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookmark_url_key_unique` ON `bookmarks` (`url_key`);--> statement-breakpoint
CREATE INDEX `bookmark_updated_at_idx` ON `bookmarks` (`updated_at`);--> statement-breakpoint
CREATE INDEX `bookmark_archived_unread_idx` ON `bookmarks` (`is_archived`,`is_unread`);--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tags` (`name`);