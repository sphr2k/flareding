import { DurableObject } from "cloudflare:workers";
import { and, desc, eq, exists, gte, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations/migrations.js";
import { bookmarks, bookmarkTags, importBatches, tags } from "../db/schema.js";
import type { ImportBatchInput, ImportBatchResult, ImportStats } from "../import/batch-schema.js";
import { stableJson } from "../import/digest.js";
import type {
  BookmarkCreate,
  BookmarkDTO,
  BookmarkPatch,
  TagDTO,
} from "../api/linkding/v1/contract.js";
import type { Env } from "../env.js";
import { safeIconPath } from "../shared/site-host.js";
import { listMcpTags, mergeMcpTags, previewMcpTagMerges, deleteMcpTags } from "./tag-management.js";

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
    favicon_url: safeIconPath(row.url),
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

/**
 * One bounded tag query for the complete visible page instead of one query
 * per bookmark. Empty pages incur zero tag lookups.
 */
function pageTagNames(db: Db, bookmarkIds: number[]): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (!bookmarkIds.length) return result;
  const rows = db
    .select({ bookmarkId: bookmarkTags.bookmarkId, name: tags.name })
    .from(bookmarkTags)
    .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
    .where(inArray(bookmarkTags.bookmarkId, bookmarkIds))
    .orderBy(bookmarkTags.bookmarkId, tags.name)
    .all();
  for (const row of rows) {
    const values = result.get(row.bookmarkId);
    if (values) values.push(row.name);
    else result.set(row.bookmarkId, [row.name]);
  }
  return result;
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
    tag?: string;
    /** Flareding v1-only AND tag filters; never used by Linkding v1 routes. */
    tagsAll?: string[];
    unread?: boolean;
    archived?: boolean;
    modifiedSince?: string;
    addedSince?: string;
  }): Promise<{ count: number; results: BookmarkDTO[] }> {
    const predicates: SQL[] = [];
    if (options.archived === undefined) predicates.push(eq(bookmarks.isArchived, false));
    else predicates.push(eq(bookmarks.isArchived, options.archived));
    // LinkThing uses the legacy linkding keyword for its default Unread view.
    // Only standalone keywords are consumed; quoted/literal fragments stay text.
    let queryUnread = false;
    const query = options.q
      ?.replace(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(^|\s)!unread(?=\s|$)/gi,
        (token, boundary) => {
          if (boundary === undefined) return token;
          queryUnread = true;
          return " ";
        },
      )
      .trim();
    if (query) {
      const pattern = `%${query}%`;
      const match = or(
        like(bookmarks.title, pattern),
        like(bookmarks.description, pattern),
        like(bookmarks.notes, pattern),
        like(bookmarks.url, pattern),
      );
      if (match) predicates.push(match);
    }
    if (options.unread === true || queryUnread) predicates.push(eq(bookmarks.isUnread, true));
    if (options.tag) {
      // Tag name is indexed UNIQUE; bookmark_tags primary key supports the
      // following join without scanning every bookmark document.
      const tagged = this.db
        .select({ id: bookmarkTags.bookmarkId })
        .from(bookmarkTags)
        .innerJoin(tags, eq(bookmarkTags.tagId, tags.id))
        .where(eq(tags.name, options.tag));
      predicates.push(inArray(bookmarks.id, tagged));
    }
    for (const tagName of options.tagsAll ?? []) {
      // One indexed EXISTS predicate per selected tag. Each required tag
      // must be associated with the bookmark (AND, not OR).
      predicates.push(
        exists(
          this.db
            .select({ id: bookmarkTags.bookmarkId })
            .from(bookmarkTags)
            .innerJoin(tags, eq(tags.id, bookmarkTags.tagId))
            .where(and(eq(bookmarkTags.bookmarkId, bookmarks.id), eq(tags.name, tagName))),
        ),
      );
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
      results: (() => {
        const tagged = pageTagNames(
          this.db,
          found.map((row) => row.id),
        );
        return found.map((row) => toLinkding(row, tagged.get(row.id) ?? []));
      })(),
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

  async patchBookmark(
    id: number,
    input: BookmarkPatch,
  ): Promise<BookmarkDTO | null | { conflict: "url" }> {
    return this.db.transaction((tx) => {
      const existing = tx.select().from(bookmarks).where(eq(bookmarks.id, id)).get();
      if (!existing) return null;
      // Resolve URL conflicts before SQLite's UNIQUE index raises a 500.
      // The check and update execute in the same transaction.
      if (input.url !== undefined && input.url !== existing.urlKey) {
        const duplicate = tx
          .select({ id: bookmarks.id })
          .from(bookmarks)
          .where(eq(bookmarks.urlKey, input.url))
          .get();
        if (duplicate && duplicate.id !== id) return { conflict: "url" as const };
      }
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

  /** Upstream Linkding v1 contract: list every tag, including unused tags. */
  async listTags(options: {
    limit: number;
    offset: number;
    q?: string;
  }): Promise<{ count: number; results: TagDTO[] }> {
    return this.queryTagPage({ ...options, includeArchived: true });
  }

  /** Versioned Flareding v1 overlay: default only tags from active bookmarks. */
  async listFlaredingV1Tags(options: {
    limit: number;
    offset: number;
    q?: string;
    includeArchived: boolean;
  }): Promise<{ count: number; results: TagDTO[] }> {
    return this.queryTagPage(options);
  }

  private queryTagPage(options: {
    limit: number;
    offset: number;
    q?: string;
    includeArchived: boolean;
  }): { count: number; results: TagDTO[] } {
    const term = options.q?.trim();
    const inScope = options.includeArchived
      ? undefined
      : exists(
          this.db
            .select({ id: bookmarkTags.bookmarkId })
            .from(bookmarkTags)
            .innerJoin(bookmarks, eq(bookmarkTags.bookmarkId, bookmarks.id))
            .where(and(eq(bookmarkTags.tagId, tags.id), eq(bookmarks.isArchived, false))),
        );
    const filter = and(
      term ? sql`instr(lower(${tags.name}), lower(${term})) > 0` : undefined,
      inScope,
    );
    const total =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(tags)
        .where(filter)
        .get()?.count ?? 0;
    const found = this.db
      .select()
      .from(tags)
      .where(filter)
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

  async listMcpTags(options: Parameters<typeof listMcpTags>[1]) {
    return listMcpTags(this.db, options);
  }

  async mergeMcpTags(merges: Parameters<typeof mergeMcpTags>[1], dryRun: boolean) {
    return dryRun ? previewMcpTagMerges(this.db, merges) : mergeMcpTags(this.db, merges);
  }

  async deleteMcpTags(names: string[], dryRun: boolean) {
    return deleteMcpTags(this.db, names, dryRun);
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
  /**
   * Only called through a dedicated dual-secret admin endpoint.
   * One synchronous SQLite transaction contains the records, tag links AND
   * the checkpoint; retrying a completed batch never modifies user edits.
   */
  async importPinboardBatch(input: ImportBatchInput): Promise<ImportBatchResult> {
    const bytes = new TextEncoder().encode(stableJson(input.records));
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== input.digest) throw new Error("IMPORT_DIGEST_INVALID");

    return this.db.transaction((tx) => {
      const existingBatch = tx
        .select()
        .from(importBatches)
        .where(
          and(eq(importBatches.runId, input.runId), eq(importBatches.batchIndex, input.batchIndex)),
        )
        .get();
      if (existingBatch) {
        if (existingBatch.digest !== input.digest) throw new Error("IMPORT_CHECKPOINT_CONFLICT");
        return {
          replay: true,
          inserted: existingBatch.insertedCount,
          skipped: existingBatch.skippedCount,
          recordCount: existingBatch.recordCount,
        };
      }

      let inserted = 0;
      let skipped = 0;
      const tagIds = new Map<string, number>();
      for (const record of input.records) {
        const existing = tx
          .select({ id: bookmarks.id })
          .from(bookmarks)
          .where(eq(bookmarks.urlKey, record.url))
          .get();
        if (existing) {
          // Never overwrite user data, even if a prior import was interrupted.
          skipped++;
          continue;
        }
        const originalDate = new Date(record.createdAt);
        const created = tx
          .insert(bookmarks)
          .values({
            url: record.url,
            urlKey: record.url,
            title: record.title,
            description: record.description ?? "",
            notes: record.notes ?? "",
            isUnread: record.isUnread ?? false,
            shared: record.shared ?? false,
            isArchived: false,
            createdAt: originalDate,
            updatedAt: originalDate,
            metadata: record.metadata ?? null,
          })
          .returning({ id: bookmarks.id })
          .get();
        if (!created) throw new Error("IMPORT_INSERT_FAILED");
        inserted++;
        for (const name of new Set(record.tags)) {
          let tagId = tagIds.get(name);
          if (!tagId) {
            tx.insert(tags).values({ name, createdAt: originalDate }).onConflictDoNothing().run();
            tagId = tx.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get()?.id;
            if (!tagId) throw new Error("IMPORT_TAG_FAILED");
            tagIds.set(name, tagId);
          }
          tx.insert(bookmarkTags)
            .values({ bookmarkId: created.id, tagId })
            .onConflictDoNothing()
            .run();
        }
      }
      tx.insert(importBatches)
        .values({
          runId: input.runId,
          batchIndex: input.batchIndex,
          digest: input.digest,
          recordCount: input.records.length,
          insertedCount: inserted,
          skippedCount: skipped,
          createdAt: new Date(),
        })
        .run();

      return { replay: false, inserted, skipped, recordCount: input.records.length };
    });
  }

  async pinboardImportStats(runId: string): Promise<ImportStats> {
    const row = this.db
      .select({
        totalBookmarks: sql<number>`count(*)`,
        privateBookmarks: sql<number>`coalesce(sum(case when ${bookmarks.shared} = 0 then 1 else 0 end), 0)`,
        unreadBookmarks: sql<number>`coalesce(sum(case when ${bookmarks.isUnread} = 1 then 1 else 0 end), 0)`,
        firstDate: sql<number | null>`min(${bookmarks.createdAt})`,
        lastDate: sql<number | null>`max(${bookmarks.createdAt})`,
      })
      .from(bookmarks)
      .get();

    const tagCount =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(tags)
        .get()?.count ?? 0;
    const links =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(bookmarkTags)
        .get()?.count ?? 0;
    const imported = this.db
      .select({
        completedBatches: sql<number>`count(*)`,
        importedRecords: sql<number>`coalesce(sum(${importBatches.recordCount}),0)`,
        insertedRecords: sql<number>`coalesce(sum(${importBatches.insertedCount}),0)`,
        skippedRecords: sql<number>`coalesce(sum(${importBatches.skippedCount}),0)`,
      })
      .from(importBatches)
      .where(eq(importBatches.runId, runId))
      .get();
    return {
      totalBookmarks: row?.totalBookmarks ?? 0,
      privateBookmarks: row?.privateBookmarks ?? 0,
      unreadBookmarks: row?.unreadBookmarks ?? 0,
      firstDate:
        row?.firstDate === null || row?.firstDate === undefined
          ? null
          : new Date(row.firstDate).toISOString(),
      lastDate:
        row?.lastDate === null || row?.lastDate === undefined
          ? null
          : new Date(row.lastDate).toISOString(),
      tags: tagCount,
      tagAssignments: links,
      completedBatches: imported?.completedBatches ?? 0,
      importedRecords: imported?.importedRecords ?? 0,
      insertedRecords: imported?.insertedRecords ?? 0,
      skippedRecords: imported?.skippedRecords ?? 0,
    };
  }

  /** Call only after import verification; cleans orphaned tags from deleted test data. */
  async pruneOrphanTags(): Promise<number> {
    const current =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(tags)
        .where(sql`NOT EXISTS (
        SELECT 1 FROM ${bookmarkTags}
        WHERE ${bookmarkTags.tagId} = ${tags.id}
      )`)
        .get()?.count ?? 0;
    if (current > 0) {
      this.db
        .delete(tags)
        .where(sql`NOT EXISTS (
        SELECT 1 FROM ${bookmarkTags}
        WHERE ${bookmarkTags.tagId} = ${tags.id}
      )`)
        .run();
    }
    return current;
  }
}
