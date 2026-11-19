CREATE TABLE `bookmark_asset_chunks` (
	`asset_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`bytes` blob NOT NULL,
	CONSTRAINT `bookmark_asset_chunks_pk` PRIMARY KEY(`asset_id`, `sequence`),
	CONSTRAINT `fk_bookmark_asset_chunks_asset_id_bookmark_assets_id_fk` FOREIGN KEY (`asset_id`) REFERENCES `bookmark_assets`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `bookmark_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`bookmark` integer NOT NULL,
	`date_created` integer NOT NULL,
	`file_size` integer NOT NULL,
	`asset_type` text NOT NULL,
	`content_type` text NOT NULL,
	`display_name` text NOT NULL,
	CONSTRAINT `fk_bookmark_assets_bookmark_bookmarks_id_fk` FOREIGN KEY (`bookmark`) REFERENCES `bookmarks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `bookmark_assets_bookmark_idx` ON `bookmark_assets` (`bookmark`);