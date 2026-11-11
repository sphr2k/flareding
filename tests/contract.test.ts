import { describe, expect, it } from "vite-plus/test";
import {
  bookmarkCreate,
  bookmarkPatch,
  bookmarkDto,
  bookmarkPageInput,
  tagPageInput,
} from "../src/api/bookmark-contract.js";
import { paginationLinks } from "../src/api/pagination.js";
import { withAbsoluteFavicon } from "../src/api/favicon-url.js";

describe("linkding wire schemas derived from Drizzle", () => {
  it("accepts LinkThing tag pages while keeping bounded bookmark pages", () => {
    expect(tagPageInput.parse({ limit: "1000" }).limit).toBe(1000);
    expect(tagPageInput.safeParse({ limit: "1001" }).success).toBe(false);
    expect(bookmarkPageInput.safeParse({ limit: "1000" }).success).toBe(false);
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
    expect(bookmarkPageInput.safeParse({ unread: "yes" }).success).toBe(false);
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
