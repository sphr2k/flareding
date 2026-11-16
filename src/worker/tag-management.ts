import { asc, desc, eq, gte, inArray, lte, sql, and } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/durable-sqlite";
import { bookmarkTags, bookmarks, tags } from "../db/schema.js";

type Db = ReturnType<typeof drizzle>;
type TagRecord = { id: number; name: string };
type MergeEntry = { sources: string[]; target: string };
export type TagMergeResult = {
  target: string;
  target_created: boolean;
  sources_merged: string[];
  sources_not_found: string[];
  bookmarks_affected: number;
  error?: string;
};
export type TagDeleteResult = {
  name: string;
  deleted: boolean;
  bookmarks_affected: number;
  not_found: boolean;
};

const countLinks = sql<number>`count(${bookmarkTags.bookmarkId})`
  .mapWith(Number)
  .as("bookmark_count");
const countDistinctLinks = sql<number>`count(distinct ${bookmarkTags.bookmarkId})`.mapWith(Number);

/**
 * MCP v1 overlay tag counts are scoped to active bookmarks by default.
 * includeArchived=true adds archived bookmark associations and unused tags.
 * No tag associations are modified by read-only filtering.
 */
export function listMcpTags(
  db: Db,
  options: {
    limit: number;
    offset: number;
    q?: string;
    minCount?: number;
    maxCount?: number;
    includeArchived?: boolean;
    sort: "name" | "count" | "date_added";
    order: "asc" | "desc";
  },
): {
  count: number;
  results: Array<{ id: number; name: string; date_added: string; bookmark_count: number }>;
} {
  const term = options.q?.trim();
  const filteredNames = term ? sql`instr(lower(${tags.name}), lower(${term})) > 0` : undefined;
  const counts = db
    .select({
      id: tags.id,
      name: tags.name,
      createdAt: tags.createdAt,
      bookmarkCount: sql<number>`count(${bookmarks.id})`.mapWith(Number).as("bookmark_count"),
    })
    .from(tags)
    .leftJoin(bookmarkTags, eq(tags.id, bookmarkTags.tagId))
    .leftJoin(
      bookmarks,
      and(
        eq(bookmarkTags.bookmarkId, bookmarks.id),
        options.includeArchived ? undefined : eq(bookmarks.isArchived, false),
      ),
    )
    .where(filteredNames)
    .groupBy(tags.id)
    .as("mcp_tag_counts");
  const constraints = and(
    // Include unused tags only when the caller explicitly includes archives.
    options.includeArchived ? undefined : gte(counts.bookmarkCount, 1),
    options.minCount !== undefined ? gte(counts.bookmarkCount, options.minCount) : undefined,
    options.maxCount !== undefined ? lte(counts.bookmarkCount, options.maxCount) : undefined,
  );
  const matching = db.select().from(counts).where(constraints).as("mcp_tag_filtered");
  const total =
    db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(matching)
      .get()?.count ?? 0;
  const key =
    options.sort === "count"
      ? matching.bookmarkCount
      : options.sort === "date_added"
        ? matching.createdAt
        : matching.name;
  const direction = options.order === "desc" ? desc : asc;
  const rows = db
    .select()
    .from(matching)
    .orderBy(direction(key), asc(matching.name), asc(matching.id))
    .limit(options.limit)
    .offset(options.offset)
    .all();
  return {
    count: total,
    results: rows.map((row) => ({
      id: row.id,
      name: row.name,
      date_added: row.createdAt.toISOString(),
      bookmark_count: row.bookmarkCount,
    })),
  };
}

const folded = (name: string) => name.toLowerCase();

/** Indexed by original exact spelling and by case-insensitive spelling. */
class TagCatalog {
  readonly byName = new Map<string, TagRecord>();
  readonly byFold = new Map<string, Set<TagRecord>>();
  constructor(rows: TagRecord[]) {
    for (const row of rows) this.add(row);
  }
  add(row: TagRecord) {
    this.byName.set(row.name, row);
    const key = folded(row.name);
    const variants = this.byFold.get(key) ?? new Set<TagRecord>();
    variants.add(row);
    this.byFold.set(key, variants);
  }
  remove(row: TagRecord) {
    this.byName.delete(row.name);
    const key = folded(row.name);
    const variants = this.byFold.get(key)!;
    variants.delete(row);
    if (!variants.size) this.byFold.delete(key);
  }
  rename(row: TagRecord, name: string) {
    this.remove(row);
    row.name = name;
    this.add(row);
  }
  variants(name: string): TagRecord[] {
    return [...(this.byFold.get(folded(name)) ?? [])].sort((a, b) => a.id - b.id);
  }
}

function normalizeEntry(entry: MergeEntry): MergeEntry {
  const target = entry.target.trim();
  if (!target || target.length > 120) throw new Error("Target must be 1–120 characters");
  if (!entry.sources.length) throw new Error("Each merge must have at least one source name");
  const sources = [...new Set(entry.sources.map((source) => source.trim()))];
  if (sources.some((source) => !source || source.length > 120))
    throw new Error("Source names must be 1–120 characters");
  return { target, sources };
}

function failedMerge(entry: MergeEntry, cause: unknown): TagMergeResult {
  const message = cause instanceof Error ? cause.message : "";
  const validationError = /^(Target must|Each merge must|Source names must)/.test(message);
  return {
    target: entry.target,
    target_created: false,
    sources_merged: [],
    sources_not_found: [],
    bookmarks_affected: 0,
    error: validationError ? message : "Merge failed; entry rolled back",
  };
}

function resolveMerge(catalog: TagCatalog, entry: MergeEntry) {
  const variants = catalog.variants(entry.target);
  const target = catalog.byName.get(entry.target) ?? variants[0];
  const sourceNames = entry.sources.filter((name) => folded(name) !== folded(entry.target));
  const sourceRows: TagRecord[] = [];
  const missing: string[] = [];
  for (const name of sourceNames) {
    const source = catalog.byName.get(name);
    if (source) sourceRows.push(source);
    else missing.push(name);
  }
  // Case-equivalent source names are intentionally excluded from explicit sources,
  // but all existing case variants of the target are canonicalized into one tag.
  const moved = [
    ...new Map(
      [...sourceRows, ...variants.filter((row) => row.id !== target?.id)].map((row) => [
        row.id,
        row,
      ]),
    ).values(),
  ];
  const affectedIds = [
    ...new Set([
      ...moved.map((row) => row.id),
      ...(target && target.name !== entry.target ? [target.id] : []),
    ]),
  ];
  return { target, moved, affectedIds, missing, sourceRows };
}

/**
 * Per-entry SQLite transaction: association transfer is a set-based INSERT SELECT
 * with conflict handling; deleting source associations and source tag rows happens
 * in the same transaction. No bookmark row is updated, so date_modified is stable.
 */
export function mergeMcpTags(db: Db, merges: MergeEntry[]): TagMergeResult[] {
  const catalog = new TagCatalog(db.select({ id: tags.id, name: tags.name }).from(tags).all());
  return merges.map((original) => {
    try {
      const entry = normalizeEntry(original);
      const plan = resolveMerge(catalog, entry);
      const result = db.transaction((tx) => {
        let targetId = plan.target?.id;
        if (targetId === undefined) {
          targetId = tx
            .insert(tags)
            .values({ name: entry.target, createdAt: new Date() })
            .returning({ id: tags.id })
            .get()!.id;
        }
        // Chunk SQL IN parameters for large source arrays without weakening the
        // per-entry transaction guarantee. Deduplicate affected bookmarks across chunks.
        const affectedIds = plan.affectedIds;
        let affected = 0;
        if (affectedIds.length && affectedIds.length <= 250) {
          affected =
            tx
              .select({ count: countDistinctLinks })
              .from(bookmarkTags)
              .where(inArray(bookmarkTags.tagId, affectedIds))
              .get()?.count ?? 0;
        } else if (affectedIds.length) {
          const distinct = new Set<number>();
          for (let start = 0; start < affectedIds.length; start += 250) {
            const chunk = affectedIds.slice(start, start + 250);
            for (const { bookmarkId } of tx
              .select({ bookmarkId: bookmarkTags.bookmarkId })
              .from(bookmarkTags)
              .where(inArray(bookmarkTags.tagId, chunk))
              .all())
              distinct.add(bookmarkId);
          }
          affected = distinct.size;
        }
        const moveIds = plan.moved.map((row) => row.id);
        for (let start = 0; start < moveIds.length; start += 250) {
          const chunk = moveIds.slice(start, start + 250);
          tx.insert(bookmarkTags)
            .select(
              tx
                .select({
                  bookmarkId: bookmarkTags.bookmarkId,
                  tagId: sql<number>`${targetId}`.as("tag_id"),
                })
                .from(bookmarkTags)
                .where(inArray(bookmarkTags.tagId, chunk)),
            )
            .onConflictDoNothing()
            .run();
          tx.delete(bookmarkTags).where(inArray(bookmarkTags.tagId, chunk)).run();
          tx.delete(tags).where(inArray(tags.id, chunk)).run();
        }
        if (plan.target && plan.target.name !== entry.target)
          tx.update(tags).set({ name: entry.target }).where(eq(tags.id, plan.target.id)).run();
        return { targetId, affected };
      });
      for (const row of plan.moved) catalog.remove(row);
      if (plan.target) {
        if (plan.target.name !== entry.target) catalog.rename(plan.target, entry.target);
      } else catalog.add({ id: result.targetId, name: entry.target });
      return {
        target: entry.target,
        target_created: !plan.target,
        sources_merged: plan.sourceRows.map((row) => row.name),
        sources_not_found: plan.missing,
        bookmarks_affected: result.affected,
      };
    } catch (cause) {
      return failedMerge(original, cause);
    }
  });
}

/**
 * Dry run projects sequential batch effects in memory. Only memberships of tags
 * involved in the requested merges are read; no writes, not even rolled-back ones.
 */
export function previewMcpTagMerges(db: Db, merges: MergeEntry[]): TagMergeResult[] {
  const catalog = new TagCatalog(db.select({ id: tags.id, name: tags.name }).from(tags).all());
  const requestedNames = new Set(merges.flatMap((entry) => entry.sources.map((s) => s.trim())));
  const targetFolds = new Set(merges.map((entry) => folded(entry.target.trim())));
  const touchedIds = [...catalog.byName.values()]
    .filter((row) => requestedNames.has(row.name) || targetFolds.has(folded(row.name)))
    .map((row) => row.id);
  const links = new Map<number, Set<number>>();
  for (let start = 0; start < touchedIds.length; start += 250) {
    const rows = db
      .select({ tagId: bookmarkTags.tagId, bookmarkId: bookmarkTags.bookmarkId })
      .from(bookmarkTags)
      .where(inArray(bookmarkTags.tagId, touchedIds.slice(start, start + 250)))
      .all();
    for (const row of rows) {
      const members = links.get(row.tagId) ?? new Set<number>();
      members.add(row.bookmarkId);
      links.set(row.tagId, members);
    }
  }
  let syntheticId = -1;
  return merges.map((original) => {
    try {
      const entry = normalizeEntry(original);
      const plan = resolveMerge(catalog, entry);
      const affected = new Set<number>();
      for (const id of plan.affectedIds)
        for (const bookmarkId of links.get(id) ?? []) affected.add(bookmarkId);
      let target = plan.target;
      if (!target) {
        target = { id: syntheticId--, name: entry.target };
        catalog.add(target);
      }
      const targetMembers = links.get(target.id) ?? new Set<number>();
      for (const row of plan.moved) {
        for (const bookmarkId of links.get(row.id) ?? []) targetMembers.add(bookmarkId);
        links.delete(row.id);
        catalog.remove(row);
      }
      links.set(target.id, targetMembers);
      if (target.name !== entry.target) catalog.rename(target, entry.target);
      return {
        target: entry.target,
        target_created: !plan.target,
        sources_merged: plan.sourceRows.map((row) => row.name),
        sources_not_found: plan.missing,
        bookmarks_affected: affected.size,
      };
    } catch (cause) {
      return failedMerge(original, cause);
    }
  });
}

/** Each delete is an independent transaction; bookmarks and their timestamps survive. */
export function deleteMcpTags(db: Db, names: string[], dryRun: boolean): TagDeleteResult[] {
  const catalog = new TagCatalog(db.select({ id: tags.id, name: tags.name }).from(tags).all());
  return names.map((name) => {
    const tag = catalog.byName.get(name);
    if (!tag) return { name, deleted: false, bookmarks_affected: 0, not_found: true };
    const affected = db.transaction((tx) => {
      const count =
        tx
          .select({ count: countLinks })
          .from(bookmarkTags)
          .where(eq(bookmarkTags.tagId, tag.id))
          .get()?.count ?? 0;
      if (!dryRun) {
        tx.delete(bookmarkTags).where(eq(bookmarkTags.tagId, tag.id)).run();
        tx.delete(tags).where(eq(tags.id, tag.id)).run();
      }
      return count;
    });
    catalog.remove(tag);
    return { name, deleted: true, bookmarks_affected: affected, not_found: false };
  });
}
