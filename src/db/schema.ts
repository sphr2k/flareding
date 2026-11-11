import {
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
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    urlKey: text("url_key").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    notes: text("notes").notNull().default(""),
    isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
    isUnread: integer("is_unread", { mode: "boolean" }).notNull().default(false),
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
    id: text("id").primaryKey(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tag_name_unique").on(t.name)],
);

export const bookmarkTags = sqliteTable(
  "bookmark_tags",
  {
    bookmarkId: text("bookmark_id")
      .notNull()
      .references(() => bookmarks.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.bookmarkId, t.tagId] }),
    index("bookmark_tag_tag_id_idx").on(t.tagId),
  ],
);
