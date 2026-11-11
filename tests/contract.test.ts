import { describe, expect, it } from "vite-plus/test";
import { bookmarkCreate, bookmarkPatch, bookmarkDto } from "../src/api/bookmark-contract.js";
import { paginationLinks } from "../src/api/pagination.js";

describe("linkding wire schemas derived from Drizzle", () => {
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

  it("produces linkding-compatible absolute pagination links", () => {
    expect(
      paginationLinks("https://bookmarks.example/api/bookmarks/?q=sqlite", 250, 100, 100),
    ).toEqual({
      next: "https://bookmarks.example/api/bookmarks/?q=sqlite&limit=100&offset=200",
      previous: "https://bookmarks.example/api/bookmarks/?q=sqlite&limit=100&offset=0",
    });
    expect(paginationLinks("https://example.com/api/bookmarks/", 10, 100, 0)).toEqual({
      next: null,
      previous: null,
    });
  });
});
