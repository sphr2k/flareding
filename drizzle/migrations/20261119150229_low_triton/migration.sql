CREATE TABLE `bundles` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`search` text DEFAULT '' NOT NULL,
	`any_tags` text DEFAULT '' NOT NULL,
	`all_tags` text DEFAULT '' NOT NULL,
	`excluded_tags` text DEFAULT '' NOT NULL,
	`filter_unread` text DEFAULT 'off' NOT NULL,
	`filter_shared` text DEFAULT 'off' NOT NULL,
	`sort_order` integer NOT NULL,
	`date_created` integer NOT NULL,
	`date_modified` integer NOT NULL
);
