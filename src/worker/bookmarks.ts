import { DurableObject } from "cloudflare:workers";
import { and, desc, eq, gte, like, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations/migrations.js";
import { bookmarks, bookmarkTags, tags } from "../db/schema.js";
import type {
  BookmarkCreate,
  BookmarkDTO,
  BookmarkPatch,
  TagDTO,
} from "../api/bookmark-contract.js";
import type { Env } from "../env.js";

type BookmarkRow = typeof bookmarks.$inferSelect;
type Db = ReturnType<typeof drizzle>;
type QueryTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

function toLinkding(row: BookmarkRow, tagNames: string[]): BookmarkDTO {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    notes: row.notes,
    is_archived: row.isArchived,
    unread: row.isUnread,
    shared: row.shared,
    tag_names: tagNames,
    date_added: row.createdAt.toISOString(),
    date_modified: row.updatedAt.toISOString(),
    web_archive_snapshot_url: null,
    favicon_url: null,
    preview_image_url: null,
  };
}

function tagNames(db: Db | QueryTransaction, bookmarkId: number): string[] {
  return db
    .select({ name: tags.name })
    .from(bookmarkTags)
    .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
    .where(eq(bookmarkTags.bookmarkId, bookmarkId))
    .orderBy(tags.name)
    .all()
    .map((row) => row.name);
}

function reconcileTags(db: QueryTransaction, bookmarkId: number, input: readonly string[]): void {
  const unique = [...new Set(input.map((name) => name.trim()).filter(Boolean))];
  db.delete(bookmarkTags).where(eq(bookmarkTags.bookmarkId, bookmarkId)).run();
  for (const name of unique) {
    db.insert(tags).values({ name, createdAt: new Date() }).onConflictDoNothing().run();
    const tag = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
    if (!tag) throw new Error("Failed to retrieve tag after insert");
    db.insert(bookmarkTags).values({ bookmarkId, tagId: tag.id }).onConflictDoNothing().run();
  }
}

/** One SQLite-backed Durable Object per logical account, exposed using native DO RPC. */
export class BookmarkDO extends DurableObject<Env> {
  private readonly db;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      migrate(this.db, migrations);
    });
  }

  async health(): Promise<boolean> {
    this.db.select({ id: bookmarks.id }).from(bookmarks).limit(1).all();
    return true;
  }

  async listBookmarks(options: {
    limit: number;
    offset: number;
    q?: string;
    archived?: boolean;
    modifiedSince?: string;
    addedSince?: string;
  }): Promise<{ count: number; results: BookmarkDTO[] }> {
    const predicates: SQL[] = [];
    if (options.archived === undefined) predicates.push(eq(bookmarks.isArchived, false));
    else predicates.push(eq(bookmarks.isArchived, options.archived));
    if (options.q?.trim()) {
      const pattern = `%${options.q.trim()}%`;
      const match = or(
        like(bookmarks.title, pattern),
        like(bookmarks.description, pattern),
        like(bookmarks.notes, pattern),
        like(bookmarks.url, pattern),
      );
      if (match) predicates.push(match);
    }
    if (options.modifiedSince) {
      predicates.push(gte(bookmarks.updatedAt, new Date(options.modifiedSince)));
    }
    if (options.addedSince) {
      predicates.push(gte(bookmarks.createdAt, new Date(options.addedSince)));
    }
    const where = and(...predicates);
    const total = this.db
      .select({ count: sql<number>`count(*)` })
      .from(bookmarks)
      .where(where)
      .get();
    const found = this.db
      .select()
      .from(bookmarks)
      .where(where)
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
      .limit(options.limit)
      .offset(options.offset)
      .all();
    return {
      count: total?.count ?? 0,
      results: found.map((row) => toLinkding(row, tagNames(this.db, row.id))),
    };
  }

  async getBookmark(id: number): Promise<BookmarkDTO | null> {
    const row = this.db.select().from(bookmarks).where(eq(bookmarks.id, id)).get();
    return row ? toLinkding(row, tagNames(this.db, id)) : null;
  }

  async saveBookmark(input: BookmarkCreate): Promise<BookmarkDTO> {
    return this.db.transaction((tx) => {
      const existing = tx.select().from(bookmarks).where(eq(bookmarks.urlKey, input.url)).get();
      const values = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.is_archived !== undefined ? { isArchived: input.is_archived } : {}),
        ...(input.unread !== undefined ? { isUnread: input.unread } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
        updatedAt: new Date(),
      };
      const row = existing
        ? tx.update(bookmarks).set(values).where(eq(bookmarks.id, existing.id)).returning().get()
        : tx
            .insert(bookmarks)
            .values({
              id: undefined,
              url: input.url,
              urlKey: input.url,
              title: input.title ?? "",
              description: input.description ?? "",
              notes: input.notes ?? "",
              isArchived: input.is_archived ?? false,
              isUnread: input.unread ?? false,
              shared: input.shared ?? false,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning()
            .get();
      if (!row) throw new Error("Failed to persist bookmark");
      if (input.tag_names !== undefined) reconcileTags(tx, row.id, input.tag_names);
      return toLinkding(row, tagNames(tx, row.id));
    });
  }

  async patchBookmark(id: number, input: BookmarkPatch): Promise<BookmarkDTO | null> {
    return this.db.transaction((tx) => {
      const existing = tx.select().from(bookmarks).where(eq(bookmarks.id, id)).get();
      if (!existing) return null;
      const values = {
        ...(input.url !== undefined ? { url: input.url, urlKey: input.url } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.is_archived !== undefined ? { isArchived: input.is_archived } : {}),
        ...(input.unread !== undefined ? { isUnread: input.unread } : {}),
        ...(input.shared !== undefined ? { shared: input.shared } : {}),
        updatedAt: new Date(),
      };
      const row = tx.update(bookmarks).set(values).where(eq(bookmarks.id, id)).returning().get();
      if (!row) return null;
      if (input.tag_names !== undefined) reconcileTags(tx, id, input.tag_names);
      return toLinkding(row, tagNames(tx, id));
    });
  }

  async setArchived(id: number, archived: boolean): Promise<BookmarkDTO | null> {
    const row = this.db
      .update(bookmarks)
      .set({ isArchived: archived, updatedAt: new Date() })
      .where(eq(bookmarks.id, id))
      .returning()
      .get();
    return row ? toLinkding(row, tagNames(this.db, id)) : null;
  }

  async deleteBookmark(id: number): Promise<boolean> {
    return (
      this.db
        .delete(bookmarks)
        .where(eq(bookmarks.id, id))
        .returning({ id: bookmarks.id })
        .get() !== undefined
    );
  }

  async listTags(options: {
    limit: number;
    offset: number;
  }): Promise<{ count: number; results: TagDTO[] }> {
    const total =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(tags)
        .get()?.count ?? 0;
    const found = this.db
      .select()
      .from(tags)
      .orderBy(tags.name)
      .limit(options.limit)
      .offset(options.offset)
      .all();
    return {
      count: total,
      results: found.map((row) => ({
        id: row.id,
        name: row.name,
        date_added: row.createdAt.toISOString(),
      })),
    };
  }

  async getTag(id: number): Promise<TagDTO | null> {
    const tag = this.db.select().from(tags).where(eq(tags.id, id)).get();
    return tag ? { id: tag.id, name: tag.name, date_added: tag.createdAt.toISOString() } : null;
  }

  async createTag(name: string): Promise<TagDTO> {
    const row =
      this.db
        .insert(tags)
        .values({ name, createdAt: new Date() })
        .onConflictDoNothing()
        .returning()
        .get() ?? this.db.select().from(tags).where(eq(tags.name, name)).get();
    if (!row) throw new Error("Failed to persist tag");
    return { id: row.id, name: row.name, date_added: row.createdAt.toISOString() };
  }

  async deleteTag(id: number): Promise<boolean> {
    return (
      this.db.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id }).get() !== undefined
    );
  }
}
