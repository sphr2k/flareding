import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  deleteMcpTags,
  listMcpTags,
  mergeMcpTags,
  previewMcpTagMerges,
} from "../src/worker/tag-management.js";
import type { BookmarkDO } from "../src/worker/bookmarks.js";

type Db = Parameters<typeof listMcpTags>[0];

function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE bookmarks (
      id integer PRIMARY KEY AUTOINCREMENT,
      url text NOT NULL, url_key text NOT NULL, title text NOT NULL,
      description text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
      is_archived integer NOT NULL DEFAULT 0, is_unread integer NOT NULL DEFAULT 0,
      shared integer NOT NULL DEFAULT 0, created_at integer NOT NULL,
      updated_at integer NOT NULL, metadata text
    );
    CREATE TABLE tags (id integer PRIMARY KEY AUTOINCREMENT, name text NOT NULL UNIQUE,
      created_at integer NOT NULL);
    CREATE TABLE bookmark_tags (bookmark_id integer NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
      tag_id integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (bookmark_id,tag_id));
    CREATE INDEX bookmark_tag_tag_id_idx ON bookmark_tags(tag_id);
  `);
  const at = Date.parse("2012-02-03T04:05:06.000Z");
  const created = Date.parse("2006-01-02T03:04:05.000Z");
  const tagIds = new Map<string, number>();
  const associate = (bookmarkId: number, names: string[], archived = false) => {
    sqlite
      .query(`INSERT INTO bookmarks
      (id,url,url_key,title,created_at,updated_at,is_archived)
      VALUES (?,?,?,?,?,?,?)`)
      .run(
        bookmarkId,
        `https://example.org/${bookmarkId}`,
        `https://example.org/${bookmarkId}`,
        `Fixture ${bookmarkId}`,
        at,
        at,
        archived ? 1 : 0,
      );
    for (const name of names) {
      let tagId = tagIds.get(name);
      if (!tagId) {
        sqlite.query("INSERT INTO tags(name,created_at) VALUES (?,?)").run(name, created);
        tagId = (sqlite.query("SELECT id FROM tags WHERE name = ?").get(name) as { id: number }).id;
        tagIds.set(name, tagId);
      }
      sqlite
        .query("INSERT INTO bookmark_tags(bookmark_id,tag_id) VALUES (?,?)")
        .run(bookmarkId, tagId);
    }
  };
  associate(1, ["k8s", "kube", "Kubernetes", "docs", "#"]);
  associate(2, ["k8s", "kubernetes", "docs"]);
  associate(3, ["kube", "docs"], true);
  associate(4, ["Kubernetes", "1709"]);
  associate(5, ["opensource", "+"]);
  // count=0 must also be preserved and correctly sortable/filterable
  sqlite.query("INSERT INTO tags(name,created_at) VALUES ('empty',?)").run(created);
  const db = drizzle({ client: sqlite }) as unknown as Db;
  const tagLinks = (name: string) =>
    (
      sqlite
        .query(`
    SELECT bookmark_id FROM bookmark_tags JOIN tags ON tags.id = bookmark_tags.tag_id
    WHERE tags.name = ? ORDER BY bookmark_id`)
        .all(name) as Array<{ bookmark_id: number }>
    ).map((v) => v.bookmark_id);
  const names = () =>
    (sqlite.query("SELECT name FROM tags ORDER BY name").all() as Array<{ name: string }>).map(
      (v) => v.name,
    );
  const updatedAt = () => sqlite.query("SELECT id,updated_at FROM bookmarks ORDER BY id").all();
  return { sqlite, db, tagLinks, names, updatedAt, close: () => sqlite.close() };
}

const options = {
  limit: 500,
  offset: 0,
  sort: "name" as const,
  order: "asc" as const,
};

test("list_tags usage includes archived bookmarks, zero counts and stable pagination/sorting", () => {
  const f = fixture();
  try {
    const all = listMcpTags(f.db, options);
    expect(all.count).toBe(10);
    expect(all.results.find((tag) => tag.name === "kube")?.bookmark_count).toBe(2);
    expect(all.results.find((tag) => tag.name === "docs")?.bookmark_count).toBe(3);
    expect(all.results.find((tag) => tag.name === "empty")?.bookmark_count).toBe(0);
    expect(all.results.every((tag) => tag.date_added === "2006-01-02T03:04:05.000Z")).toBe(true);
    expect(listMcpTags(f.db, { ...options, q: "KUBE" }).results.map((t) => t.name)).toEqual([
      "Kubernetes",
      "kube",
      "kubernetes",
    ]);
    const counted = listMcpTags(f.db, {
      ...options,
      minCount: 2,
      maxCount: 2,
      sort: "count",
      order: "desc",
    });
    expect(counted.count).toBe(3);
    expect(counted.results.map((t) => t.name)).toEqual(["Kubernetes", "k8s", "kube"]);
    const page = listMcpTags(f.db, {
      ...options,
      minCount: 2,
      sort: "count",
      order: "desc",
      limit: 2,
      offset: 1,
    });
    expect(page.count).toBe(4);
    expect(page.results.map((t) => t.name)).toEqual(["Kubernetes", "k8s"]);
    expect(listMcpTags(f.db, { ...options, maxCount: 0 }).results.map((t) => t.name)).toEqual([
      "empty",
    ]);
    expect(
      listMcpTags(f.db, { ...options, sort: "date_added", order: "desc", limit: 1 }).results,
    ).toHaveLength(1);
  } finally {
    f.close();
  }
});

test("sequential dry_run exactly predicts overlapping batch merges without any writes", () => {
  const f = fixture();
  try {
    const beforeTags = f.names();
    const beforeTimestamps = f.updatedAt();
    const entries = [
      { sources: ["k8s", "kube", "Kubernetes"], target: "kubernetes" },
      { sources: ["kubernetes"], target: "platform" },
      { sources: ["opensource"], target: "open-source" },
      { sources: ["does-not-exist"], target: "brand-new" },
    ];
    const preview = previewMcpTagMerges(f.db, entries);
    expect(preview.map((result) => result.bookmarks_affected)).toEqual([4, 4, 1, 0]);
    expect(preview.map((result) => result.target_created)).toEqual([false, true, true, true]);
    expect(preview[0]?.sources_merged).toEqual(["k8s", "kube"]);
    expect(preview[0]?.sources_not_found).toEqual([]);
    expect(preview[3]?.sources_not_found).toEqual(["does-not-exist"]);
    expect(f.names()).toEqual(beforeTags);
    expect(f.updatedAt()).toEqual(beforeTimestamps);
    const applied = mergeMcpTags(f.db, entries);
    expect(applied).toEqual(preview);
    expect(f.tagLinks("platform")).toEqual([1, 2, 3, 4]);
    expect(f.tagLinks("open-source")).toEqual([5]);
    for (const name of ["k8s", "kube", "Kubernetes", "kubernetes", "opensource"])
      expect(f.names()).not.toContain(name);
    expect(f.names()).toContain("brand-new");
    expect(f.updatedAt()).toEqual(beforeTimestamps);
    const repeated = mergeMcpTags(f.db, entries);
    expect(repeated[0]).toMatchObject({
      bookmarks_affected: 0,
      sources_not_found: ["k8s", "kube"],
    });
    // The first mapping recreates an empty target (as requested), which the
    // second mapping consumes; the rerun never changes any bookmark association.
    expect(repeated[1]).toMatchObject({ bookmarks_affected: 0, sources_merged: ["kubernetes"] });
  } finally {
    f.close();
  }
});

test("case-only rename retains id, createdAt, associations, bookmark timestamps", () => {
  const f = fixture();
  try {
    const originalId = (
      f.sqlite.query("SELECT id FROM tags WHERE name = 'Kubernetes'").get() as { id: number }
    ).id;
    const before = f.updatedAt();
    const entry = [{ sources: ["Kubernetes"], target: "kUbErNeTeS" }];
    const preview = previewMcpTagMerges(f.db, entry);
    expect(preview).toMatchObject([
      { target_created: false, sources_merged: [], bookmarks_affected: 3 },
    ]);
    expect(mergeMcpTags(f.db, entry)).toEqual(preview);
    expect(f.tagLinks("kUbErNeTeS")).toEqual([1, 2, 4]);
    expect(f.sqlite.query("SELECT id FROM tags WHERE name = 'kUbErNeTeS'").get()).toEqual({
      id: originalId,
    });
    expect(f.updatedAt()).toEqual(before);
  } finally {
    f.close();
  }
});

test("one invalid merge entry is reported, rolled back, and later entries still commit", () => {
  const f = fixture();
  try {
    const entries = [
      { sources: ["k8s"], target: "platform" },
      { sources: [], target: "should-not-exist" },
      { sources: ["opensource"], target: "open-source" },
    ];
    const preview = previewMcpTagMerges(f.db, entries);
    const actual = mergeMcpTags(f.db, entries);
    expect(actual).toEqual(preview);
    expect(actual[1]?.error).toContain("at least one");
    expect(f.names()).not.toContain("should-not-exist");
    expect(f.tagLinks("platform")).toEqual([1, 2]);
    expect(f.tagLinks("open-source")).toEqual([5]);
  } finally {
    f.close();
  }
});

test("delete_tags previews sequential duplicates, deletes associations but leaves bookmarks untouched", () => {
  const f = fixture();
  try {
    const before = f.updatedAt();
    const names = ["#", "+", "1709", "not-found", "#"];
    const dry = deleteMcpTags(f.db, names, true);
    expect(dry).toEqual([
      { name: "#", deleted: true, bookmarks_affected: 1, not_found: false },
      { name: "+", deleted: true, bookmarks_affected: 1, not_found: false },
      { name: "1709", deleted: true, bookmarks_affected: 1, not_found: false },
      { name: "not-found", deleted: false, bookmarks_affected: 0, not_found: true },
      { name: "#", deleted: false, bookmarks_affected: 0, not_found: true },
    ]);
    expect(f.names()).toContain("#");
    expect(deleteMcpTags(f.db, names, false)).toEqual(dry);
    expect(f.names()).not.toContain("#");
    expect(f.sqlite.query("SELECT count(*) AS n FROM bookmarks").get()).toEqual({ n: 5 });
    expect(f.updatedAt()).toEqual(before);
  } finally {
    f.close();
  }
});

test("SQLite constraint failure rolls back its own mapping but not surrounding mappings", () => {
  const f = fixture();
  try {
    const before = f.updatedAt();
    f.sqlite.exec(`
      CREATE TRIGGER reject_bad_target BEFORE INSERT ON tags
      WHEN new.name = 'broken-target'
      BEGIN SELECT RAISE(ABORT, 'simulated constraint violation'); END;
    `);
    const results = mergeMcpTags(f.db, [
      { sources: ["k8s"], target: "platform" },
      { sources: ["kube"], target: "broken-target" },
      { sources: ["opensource"], target: "open-source" },
    ]);
    expect(results[0]).toMatchObject({ bookmarks_affected: 2 });
    expect(results[1]).toMatchObject({
      bookmarks_affected: 0,
      error: "Merge failed; entry rolled back",
    });
    expect(results[2]).toMatchObject({ bookmarks_affected: 1 });
    expect(f.tagLinks("kube")).toEqual([1, 3]);
    expect(f.names()).not.toContain("broken-target");
    expect(f.tagLinks("platform")).toEqual([1, 2]);
    expect(f.tagLinks("open-source")).toEqual([5]);
    expect(f.updatedAt()).toEqual(before);
  } finally {
    f.close();
  }
});

test("500-entry dry run returns per-entry results with no writes", () => {
  const f = fixture();
  try {
    const initial = f.names();
    const entries = Array.from({ length: 500 }, (_, i) => ({
      sources: ["nonexistent-" + i],
      target: "target-" + i,
    }));
    const result = previewMcpTagMerges(f.db, entries);
    expect(result).toHaveLength(500);
    expect(result[0]).toMatchObject({ target_created: true, bookmarks_affected: 0 });
    expect(f.names()).toEqual(initial);
  } finally {
    f.close();
  }
});

test("500 actual merges preserve uniqueness on a shared bookmark", () => {
  const f = fixture();
  try {
    const before = f.updatedAt();
    f.sqlite.exec("BEGIN TRANSACTION");
    for (let i = 0; i < 500; i++) {
      const name = `legacy-${i}`;
      const insert = f.sqlite
        .query("INSERT INTO tags(name,created_at) VALUES (?,?)")
        .run(name, Date.now());
      f.sqlite
        .query("INSERT INTO bookmark_tags(bookmark_id,tag_id) VALUES (?,?)")
        .run(1, Number(insert.lastInsertRowid));
    }
    f.sqlite.exec("COMMIT");
    const mappings = Array.from({ length: 500 }, (_, i) => ({
      sources: [`legacy-${i}`],
      target: "canonical-bulk",
    }));
    const preview = previewMcpTagMerges(f.db, mappings);
    expect(preview).toHaveLength(500);
    expect(preview.every((result) => result.bookmarks_affected === 1)).toBe(true);
    expect(mergeMcpTags(f.db, mappings)).toEqual(preview);
    expect(f.tagLinks("canonical-bulk")).toEqual([1]);
    expect(f.names().some((name) => name.startsWith("legacy-"))).toBe(false);
    expect(f.updatedAt()).toEqual(before);
  } finally {
    f.close();
  }
});

test("one mapping can merge more than 500 source names atomically in SQL chunks", () => {
  const f = fixture();
  try {
    const before = f.updatedAt();
    const sources = Array.from({ length: 601 }, (_, i) => `large-legacy-${i}`);
    f.sqlite.exec("BEGIN TRANSACTION");
    for (const name of sources) {
      const created = f.sqlite
        .query("INSERT INTO tags(name,created_at) VALUES (?,?)")
        .run(name, Date.now());
      f.sqlite
        .query("INSERT INTO bookmark_tags(bookmark_id,tag_id) VALUES (?,?)")
        .run(1, Number(created.lastInsertRowid));
    }
    f.sqlite.exec("COMMIT");
    const mapping = [{ sources, target: "large-canonical" }];
    const preview = previewMcpTagMerges(f.db, mapping);
    expect(preview[0]).toMatchObject({
      sources_merged: sources,
      bookmarks_affected: 1,
      target_created: true,
    });
    expect(mergeMcpTags(f.db, mapping)).toEqual(preview);
    expect(f.tagLinks("large-canonical")).toEqual([1]);
    expect(f.names().some((name) => name.startsWith("large-legacy-"))).toBe(false);
    expect(f.updatedAt()).toEqual(before);
  } finally {
    f.close();
  }
});
