import { DurableObject } from "cloudflare:workers";
import { and, asc, desc, eq, exists, gt, inArray, notExists, or, sql, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../drizzle/migrations/migrations.js";
import {
  bookmarkAssetChunks,
  bookmarkAssets,
  bookmarks,
  bookmarkTags,
  bundles,
  importBatches,
  tags,
} from "../db/schema.js";
import type { ImportBatchInput, ImportBatchResult, ImportStats } from "../import/batch-schema.js";
import { stableJson } from "../import/digest.js";
import type {
  BookmarkCreate,
  BookmarkDTO,
  BookmarkPatch,
  BookmarkSort,
  BundleCreate,
  BundlePatch,
  TagDTO,
} from "../api/linkding/v1/contract.js";
import { searchPredicate } from "../api/linkding/v1/search.js";
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
    website_title: null,
    website_description: null,
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
function assetDto(row: typeof bookmarkAssets.$inferSelect) {
  return { ...row, date_created: row.date_created.toISOString(), status: "complete" as const };
}

function bundleDto(row: typeof bundles.$inferSelect) {
  return {
    ...row,
    date_created: row.date_created.toISOString(),
    date_modified: row.date_modified.toISOString(),
  };
}

function bundleTags(text: string): string[] {
  return Array.from(text.matchAll(/"([^"]+)"|'([^']+)'|([^\s"']+)/g), (match) =>
    (match[1] ?? match[2] ?? match[3]).toLowerCase(),
  );
}

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
    linkdingSearch?: boolean;
    tag?: string;
    /** Flareding v1-only AND tag filters; never used by Linkding v1 routes. */
    tagsAll?: string[];
    unread?: boolean;
    shared?: boolean;
    sharedCollection?: boolean;
    sort?: BookmarkSort;
    bundle?: number;
    archived?: boolean;
    modifiedSince?: string;
    addedSince?: string;
  }): Promise<{ count: number; results: BookmarkDTO[] }> {
    const predicates: SQL[] = [];
    if (!options.sharedCollection)
      predicates.push(eq(bookmarks.isArchived, options.archived ?? false));
    const tagAssociations = this.db
      .select({ id: bookmarkTags.bookmarkId })
      .from(bookmarkTags)
      .where(eq(bookmarkTags.bookmarkId, bookmarks.id));
    const hasTag = (name: string) =>
      exists(
        this.db
          .select({ id: bookmarkTags.bookmarkId })
          .from(bookmarkTags)
          .innerJoin(tags, eq(tags.id, bookmarkTags.tagId))
          .where(
            and(
              eq(bookmarkTags.bookmarkId, bookmarks.id),
              sql`lower(${tags.name}) = lower(${name})`,
            ),
          ),
      );
    const textMatch = (term: string) => {
      const value = term.toLowerCase();
      return or(
        sql`instr(lower(${bookmarks.title}), ${value}) > 0`,
        sql`instr(lower(${bookmarks.description}), ${value}) > 0`,
        sql`instr(lower(${bookmarks.notes}), ${value}) > 0`,
        sql`instr(lower(${bookmarks.url}), ${value}) > 0`,
      );
    };
    if (options.q?.trim()) {
      const match = options.linkdingSearch
        ? searchPredicate(options.q, (kind, value) => {
            if (kind === "tag") return hasTag(value);
            if (kind === "text") return textMatch(value);
            if (value.toLowerCase() === "unread") return eq(bookmarks.isUnread, true);
            if (value.toLowerCase() === "untagged") return notExists(tagAssociations);
            return undefined;
          })
        : textMatch(options.q.trim());
      if (match) predicates.push(match);
    }
    if (options.unread !== undefined) predicates.push(eq(bookmarks.isUnread, options.unread));
    if (options.shared !== undefined) predicates.push(eq(bookmarks.shared, options.shared));
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
    for (const tagName of options.tagsAll ?? []) predicates.push(hasTag(tagName));
    if (options.modifiedSince) {
      predicates.push(gt(bookmarks.updatedAt, new Date(options.modifiedSince)));
    }
    if (options.addedSince) {
      predicates.push(gt(bookmarks.createdAt, new Date(options.addedSince)));
    }
    const bundle =
      options.bundle === undefined
        ? undefined
        : this.db.select().from(bundles).where(eq(bundles.id, options.bundle)).get();
    if (bundle) {
      for (const term of bundle.search.match(/"[^"]+"|\S+/g) ?? []) {
        const match = textMatch(term.replace(/^"|"$/g, ""));
        if (match) predicates.push(match);
      }
      const tagged = (names: string[]) =>
        this.db
          .select({ id: bookmarkTags.bookmarkId })
          .from(bookmarkTags)
          .innerJoin(tags, eq(tags.id, bookmarkTags.tagId))
          .where(
            and(
              eq(bookmarkTags.bookmarkId, bookmarks.id),
              inArray(sql`lower(${tags.name})`, names),
            ),
          );
      const any = bundleTags(bundle.any_tags);
      const excluded = bundleTags(bundle.excluded_tags);
      if (any.length) predicates.push(exists(tagged(any)));
      if (excluded.length) predicates.push(notExists(tagged(excluded)));
      for (const tag of bundleTags(bundle.all_tags)) predicates.push(exists(tagged([tag])));
      if (bundle.filter_unread !== "off")
        predicates.push(eq(bookmarks.isUnread, bundle.filter_unread === "yes"));
      if (bundle.filter_shared !== "off")
        predicates.push(eq(bookmarks.shared, bundle.filter_shared === "yes"));
    }
    const title = sql`lower(coalesce(nullif(${bookmarks.title}, ''), ${bookmarks.url}))`;
    const sort = {
      added_asc: asc(bookmarks.createdAt),
      added_desc: desc(bookmarks.createdAt),
      modified_asc: asc(bookmarks.updatedAt),
      modified_desc: desc(bookmarks.updatedAt),
      title_asc: asc(title),
      title_desc: desc(title),
    };
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
      .orderBy(sort[options.sort ?? "added_desc"], desc(bookmarks.id))
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

  async listAssets(bookmarkId: number, limit: number, offset: number) {
    if (
      !this.db
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(eq(bookmarks.id, bookmarkId))
        .get()
    )
      return null;
    const scope = eq(bookmarkAssets.bookmark, bookmarkId);
    const count =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(bookmarkAssets)
        .where(scope)
        .get()?.count ?? 0;
    const rows = this.db
      .select()
      .from(bookmarkAssets)
      .where(scope)
      .orderBy(desc(bookmarkAssets.id))
      .limit(limit)
      .offset(offset)
      .all();
    return { count, results: rows.map(assetDto) };
  }

  async getAsset(bookmarkId: number, assetId: number, download: boolean) {
    const row = this.db
      .select()
      .from(bookmarkAssets)
      .where(and(eq(bookmarkAssets.bookmark, bookmarkId), eq(bookmarkAssets.id, assetId)))
      .get();
    if (!row) return null;
    const asset = assetDto(row);
    if (!download) return { asset, bytes: null };
    const bytes = new Uint8Array(row.file_size);
    const chunks = this.db
      .select({ bytes: bookmarkAssetChunks.bytes })
      .from(bookmarkAssetChunks)
      .where(eq(bookmarkAssetChunks.assetId, assetId))
      .orderBy(bookmarkAssetChunks.sequence)
      .all();
    let offset = 0;
    for (const chunk of chunks) {
      const data = new Uint8Array(chunk.bytes);
      bytes.set(data, offset);
      offset += data.byteLength;
    }
    if (offset !== bytes.byteLength) throw new Error("Incomplete bookmark asset");
    return { asset, bytes };
  }

  async deleteAsset(bookmarkId: number, assetId: number) {
    return Boolean(
      this.db
        .delete(bookmarkAssets)
        .where(and(eq(bookmarkAssets.bookmark, bookmarkId), eq(bookmarkAssets.id, assetId)))
        .returning({ id: bookmarkAssets.id })
        .get(),
    );
  }

  async saveAsset(
    target: { bookmarkId: number } | { url: string },
    file: { bytes: Uint8Array; name: string; contentType: string },
  ) {
    return this.db.transaction((tx) => {
      const snapshot = "url" in target;
      const timestamp = new Date();
      const current = tx
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(snapshot ? eq(bookmarks.urlKey, target.url) : eq(bookmarks.id, target.bookmarkId))
        .get();
      const bookmark =
        current ??
        (snapshot
          ? tx
              .insert(bookmarks)
              .values({
                url: target.url,
                urlKey: target.url,
                title: "",
                createdAt: timestamp,
                updatedAt: timestamp,
              })
              .returning({ id: bookmarks.id })
              .get()
          : null);
      if (!bookmark) return null;
      const row = tx
        .insert(bookmarkAssets)
        .values({
          bookmark: bookmark.id,
          date_created: timestamp,
          file_size: file.bytes.byteLength,
          asset_type: snapshot ? "snapshot" : "upload",
          display_name: file.name,
          content_type: file.contentType,
        })
        .returning()
        .get();
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < file.bytes.byteLength; offset += chunkSize) {
        tx.insert(bookmarkAssetChunks)
          .values({
            assetId: row.id,
            sequence: offset / chunkSize,
            bytes: Buffer.from(file.bytes.subarray(offset, offset + chunkSize)),
          })
          .run();
      }
      return assetDto(row);
    });
  }

  async listBundles(limit: number, offset: number) {
    const count =
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(bundles)
        .get()?.count ?? 0;
    const results = this.db
      .select()
      .from(bundles)
      .orderBy(bundles.order, bundles.id)
      .limit(limit)
      .offset(offset)
      .all();
    return { count, results: results.map(bundleDto) };
  }

  async getBundle(id: number) {
    const row = this.db.select().from(bundles).where(eq(bundles.id, id)).get();
    return row ? bundleDto(row) : null;
  }

  async createBundle(input: BundleCreate) {
    return this.db.transaction((tx) => {
      const last = tx
        .select({ order: bundles.order })
        .from(bundles)
        .orderBy(desc(bundles.order))
        .limit(1)
        .get();
      const now = new Date();
      const row = tx
        .insert(bundles)
        .values({
          ...input,
          order: input.order ?? (last?.order ?? -1) + 1,
          date_created: now,
          date_modified: now,
        })
        .returning()
        .get();
      return bundleDto(row);
    });
  }

  async updateBundle(id: number, input: BundlePatch) {
    const row = this.db
      .update(bundles)
      .set({ ...input, date_modified: new Date() })
      .where(eq(bundles.id, id))
      .returning()
      .get();
    return row ? bundleDto(row) : null;
  }

  async deleteBundle(id: number) {
    return this.db.transaction((tx) => {
      if (!tx.delete(bundles).where(eq(bundles.id, id)).returning({ id: bundles.id }).get())
        return false;
      const remaining = tx
        .select({ id: bundles.id, order: bundles.order })
        .from(bundles)
        .orderBy(bundles.order, bundles.id)
        .all();
      remaining.forEach((row, order) => {
        if (row.order !== order)
          tx.update(bundles).set({ order }).where(eq(bundles.id, row.id)).run();
      });
      return true;
    });
  }

  async getBookmark(id: number): Promise<BookmarkDTO | null> {
    const row = this.db.select().from(bookmarks).where(eq(bookmarks.id, id)).get();
    return row ? toLinkding(row, tagNames(this.db, id)) : null;
  }

  async getBookmarkByUrl(url: string): Promise<BookmarkDTO | null> {
    const row = this.db.select().from(bookmarks).where(eq(bookmarks.urlKey, url)).get();
    return row ? toLinkding(row, tagNames(this.db, row.id)) : null;
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
        ...(input.date_added ? { createdAt: new Date(input.date_added) } : {}),
        updatedAt: input.date_modified ? new Date(input.date_modified) : new Date(),
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
              createdAt: input.date_added ? new Date(input.date_added) : new Date(),
              updatedAt: input.date_modified ? new Date(input.date_modified) : new Date(),
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
        ...(input.date_added ? { createdAt: new Date(input.date_added) } : {}),
        updatedAt: input.date_modified ? new Date(input.date_modified) : new Date(),
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

  async setArchivedBatch(ids: number[], archived: boolean) {
    const results: Array<{ id: number; updated: boolean; error?: string }> = [];
    for (const id of ids) {
      try {
        results.push({ id, updated: (await this.setArchived(id, archived)) !== null });
      } catch {
        results.push({ id, updated: false, error: "Failed to update bookmark" });
      }
    }
    return results;
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
    q?: string;
    includeArchived: boolean;
    includeUnused: boolean;
  }): Promise<{ count: number; results: TagDTO[] }> {
    const term = options.q?.trim();
    const associations = this.db
      .select({ id: bookmarkTags.bookmarkId })
      .from(bookmarkTags)
      .where(eq(bookmarkTags.tagId, tags.id));
    // An uncorrelated IN subquery is evaluated once. A correlated join lets
    // SQLite scan all active bookmarks again for every tag on each page.
    const activeTagIds = this.db
      .select({ id: bookmarkTags.tagId })
      .from(bookmarkTags)
      .innerJoin(bookmarks, eq(bookmarkTags.bookmarkId, bookmarks.id))
      .where(eq(bookmarks.isArchived, false));
    const inScope = or(
      options.includeArchived ? exists(associations) : inArray(tags.id, activeTagIds),
      options.includeUnused ? notExists(associations) : undefined,
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
