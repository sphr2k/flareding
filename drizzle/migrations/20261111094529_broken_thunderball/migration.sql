CREATE TABLE `import_batches` (
	`run_id` text NOT NULL,
	`batch_index` integer NOT NULL,
	`digest` text NOT NULL,
	`record_count` integer NOT NULL,
	`inserted_count` integer NOT NULL,
	`skipped_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `import_batches_pk` PRIMARY KEY(`run_id`, `batch_index`)
);
