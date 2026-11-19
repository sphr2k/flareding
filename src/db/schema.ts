import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Drizzle is the single source of truth. Keep public linkding DTOs separate:
 * the original API uses tag_names and date_added, not these storage columns.
 */
export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    url: text("url").notNull(),
    urlKey: text("url_key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    notes: text("notes").notNull().default(""),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    isUnread: integer("is_unread", { mode: "boolean" }).notNull().default(false),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("bookmark_url_key_unique").on(t.urlKey),
    index("bookmark_updated_at_idx").on(t.updatedAt),
    index("bookmark_archived_unread_idx").on(t.isArchived, t.isUnread),
  ],
);

export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("tag_name_unique").on(t.name)],
);

export const bookmarkTags = sqliteTable(
  "bookmark_tags",
  {
    bookmarkId: integer("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.bookmarkId, t.tagId] }),
    index("bookmark_tag_tag_id_idx").on(t.tagId),
  ],
);

// Import checkpoints are written atomically in the same transaction as each
// imported batch. Replaying a completed batch is safe and never overwrites
// bookmarks created or modified by the user after an import.
export const importBatches = sqliteTable(
  "import_batches",
  {
    runId: text("run_id").notNull(),
    batchIndex: integer("batch_index").notNull(),
    digest: text("digest").notNull(),
    recordCount: integer("record_count").notNull(),
    insertedCount: integer("inserted_count").notNull(),
    skippedCount: integer("skipped_count").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.batchIndex] })],
);

export const bundles = sqliteTable("bundles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  search: text("search").notNull().default(""),
  any_tags: text("any_tags").notNull().default(""),
  all_tags: text("all_tags").notNull().default(""),
  excluded_tags: text("excluded_tags").notNull().default(""),
  filter_unread: text("filter_unread", { enum: ["yes", "no", "off"] })
    .notNull()
    .default("off"),
  filter_shared: text("filter_shared", { enum: ["yes", "no", "off"] })
    .notNull()
    .default("off"),
  order: integer("sort_order").notNull(),
  date_created: integer("date_created", { mode: "timestamp_ms" }).notNull(),
  date_modified: integer("date_modified", { mode: "timestamp_ms" }).notNull(),
});

export const bookmarkAssets = sqliteTable(
  "bookmark_assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bookmark: integer("bookmark")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    date_created: integer("date_created", { mode: "timestamp_ms" }).notNull(),
    file_size: integer("file_size").notNull(),
    asset_type: text("asset_type", { enum: ["snapshot", "upload"] }).notNull(),
    content_type: text("content_type").notNull(),
    display_name: text("display_name").notNull(),
  },
  (table) => [index("bookmark_assets_bookmark_idx").on(table.bookmark)],
);

export const bookmarkAssetChunks = sqliteTable(
  "bookmark_asset_chunks",
  {
    assetId: integer("asset_id")
      .notNull()
      .references(() => bookmarkAssets.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.assetId, table.sequence] })],
);
