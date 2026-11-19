import { flaredingV1BookmarkSearchInput } from "../src/api/flareding/v1/contract.js";
import { describe, expect, it } from "vite-plus/test";
import {
  bookmarkCreate,
  bookmarkPatch,
  bookmarkDto,
  bookmarkPageInput,
  tagPageInput,
  tagPageOutput,
} from "../src/api/linkding/v1/contract.js";
import { paginationLinks } from "../src/api/linkding/v1/pagination.js";
import { withAbsoluteFavicon } from "../src/api/linkding/v1/favicon-url.js";

describe("additive Flareding v1 overlay contract", () => {
  it("types and validates include_archived on the public tag route", () => {
    expect(tagPageInput.parse({}).include_archived).toBe(false);
    expect(tagPageInput.parse({ include_archived: "true" }).include_archived).toBe(true);
    expect(tagPageInput.safeParse({ include_archived: "all" }).success).toBe(false);
    expect(
      tagPageOutput.safeParse({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 1, name: "active", date_added: "2026-11-16T00:00:00.000Z" }],
      }).success,
    ).toBe(true);
  });
});

describe("Flareding v1 multi-tag search contract", () => {
  it("validates bounded AND tags, whitespace and collection without changing Linkding", () => {
    expect(
      flaredingV1BookmarkSearchInput.parse({
        query: " kafka ",
        tags: ["Kubernetes", "two words"],
        view: "unread",
      }),
    ).toMatchObject({
      query: "kafka",
      tags: ["Kubernetes", "two words"],
      view: "unread",
      limit: 60,
    });
    expect(flaredingV1BookmarkSearchInput.safeParse({ tags: Array(13).fill("x") }).success).toBe(
      false,
    );
    expect(flaredingV1BookmarkSearchInput.safeParse({ view: "invalid" }).success).toBe(false);
    expect(Object.keys(bookmarkPageInput.shape)).not.toContain("tags");
  });
});

describe("linkding wire schemas derived from Drizzle", () => {
  it("matches upstream pagination without an application page cap", () => {
    for (const schema of [tagPageInput, bookmarkPageInput]) {
      expect(schema.parse({ limit: "1000000" }).limit).toBe(1000000);
      for (const limit of [undefined, "", "nope", "0", "-1", "1.5"])
        expect(schema.parse({ limit }).limit).toBe(100);
      for (const offset of [undefined, "", "nope", "-1", "1.5"])
        expect(schema.parse({ offset }).offset).toBe(0);
      expect(schema.parse({ limit: "+1_000", offset: "100" })).toMatchObject({
        limit: 1000,
        offset: 100,
      });
    }
  });

  it("accepts linkding field names and rejects storage-only columns", () => {
    expect(
      bookmarkCreate.safeParse({
        url: "https://example.com",
        title: "Home",
        tag_names: ["typescript", "sqlite"],
        is_archived: false,
      }).success,
    ).toBe(true);
    expect(bookmarkCreate.safeParse({ url: "https://example.com", urlKey: "evil" }).success).toBe(
      false,
    );
    expect(bookmarkCreate.safeParse({ url: "javascript:alert(1)", title: "Unsafe" }).success).toBe(
      false,
    );
    expect(
      bookmarkCreate.safeParse({ url: "ftp://example.com/file", title: "Unsafe" }).success,
    ).toBe(false);
    expect(bookmarkPatch.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("keeps partial update schemas and exposed bookmark response separate", () => {
    expect(bookmarkPatch.safeParse({ tag_names: [] }).success).toBe(true);
    expect(bookmarkPatch.safeParse({ notes: "Only a note" }).success).toBe(true);
    expect(
      bookmarkDto.safeParse({
        id: 1,
        url: "https://example.com",
        title: "",
        description: "",
        notes: "",
        is_archived: false,
        unread: false,
        shared: false,
        tag_names: [],
        date_added: "2026-11-11T00:00:00.000Z",
        date_modified: "2026-11-11T00:00:00.000Z",
        web_archive_snapshot_url: null,
        favicon_url: null,
        preview_image_url: null,
      }).success,
    ).toBe(true);
  });

  it("emits linkding-compatible absolute favicon URLs without exposing external image origins", () => {
    const bookmark = bookmarkDto.parse({
      id: 1,
      url: "https://www.github.com/owner/repo",
      title: "GitHub",
      description: "",
      notes: "",
      is_archived: false,
      unread: false,
      shared: false,
      tag_names: [],
      date_added: "2026-11-11T00:00:00Z",
      date_modified: "2026-11-11T00:00:00Z",
      favicon_url: "/api/site-icons/github.com",
      web_archive_snapshot_url: null,
      preview_image_url: null,
    });
    expect(
      withAbsoluteFavicon(bookmark, "https://flareding.example/api/bookmarks/").favicon_url,
    ).toBe("https://flareding.example/api/site-icons/github.com");
    expect(
      withAbsoluteFavicon(
        { ...bookmark, favicon_url: "https://untrusted.example/a" },
        "https://flareding.example/api/bookmarks/",
      ).favicon_url,
    ).toBeNull();
  });

  it("parses unread and tag query parameters without Boolean('false') errors", () => {
    expect(bookmarkPageInput.parse({ unread: "true", tag: "k8s" })).toMatchObject({
      unread: true,
      tag: "k8s",
    });
    expect(bookmarkPageInput.parse({ unread: "false" })).toMatchObject({ unread: false });
    expect(bookmarkPageInput.parse({ unread: "yes" }).unread).toBe(true);
    expect(bookmarkPageInput.parse({ unread: "no" }).unread).toBe(false);
    expect(bookmarkPageInput.safeParse({ unread: "maybe" }).success).toBe(false);
  });

  it("produces linkding-compatible absolute pagination links", () => {
    expect(
      paginationLinks("https://bookmarks.example/api/bookmarks/?q=sqlite", 250, 100, 100),
    ).toEqual({
      next: "https://bookmarks.example/api/bookmarks/?limit=100&offset=200&q=sqlite",
      previous: "https://bookmarks.example/api/bookmarks/?limit=100&q=sqlite",
    });
    expect(paginationLinks("https://example.com/api/bookmarks/", 10, 100, 0)).toEqual({
      next: null,
      previous: null,
    });
  });
});
