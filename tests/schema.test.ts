import { describe, expect, it } from "vite-plus/test";
import {
  bookmarkInsertSchema,
  bookmarkSelectSchema,
  bookmarkUpdateSchema,
  tagInsertSchema,
} from "../src/db/validation.js";

const validBookmark = {
  url: "https://example.com/guide",
  urlKey: "https://example.com/guide",
  title: "Example",
  createdAt: new Date("2026-11-11T00:00:00Z"),
  updatedAt: new Date("2026-11-11T00:00:00Z"),
};

describe("Drizzle-generated Zod CRUD schemas", () => {
  it("validates complete bookmark writes", () => {
    expect(bookmarkInsertSchema.safeParse(validBookmark).success).toBe(true);
    expect(bookmarkInsertSchema.safeParse({ ...validBookmark, title: 123 }).success).toBe(false);
    expect(bookmarkInsertSchema.safeParse({ ...validBookmark, url: null }).success).toBe(false);
  });

  it("supports partial updates without unchanged columns", () => {
    expect(bookmarkUpdateSchema.safeParse({ title: "Renamed" }).success).toBe(true);
    expect(bookmarkUpdateSchema.safeParse({ notes: "A note" }).success).toBe(true);
    expect(bookmarkUpdateSchema.safeParse({ isArchived: "yes" }).success).toBe(false);
  });

  it("distinguishes insert defaults from stored select rows", () => {
    expect(bookmarkSelectSchema.safeParse(validBookmark).success).toBe(false);
    expect(
      bookmarkSelectSchema.safeParse({
        ...validBookmark,
        id: 1,
        description: "",
        notes: "",
        isArchived: false,
        isUnread: false,
        shared: false,
        metadata: null,
      }).success,
    ).toBe(true);
  });

  it("validates relational tags", () => {
    expect(
      tagInsertSchema.safeParse({ name: "cloudflare", createdAt: new Date("2026-11-11") }).success,
    ).toBe(true);
    expect(tagInsertSchema.safeParse({ name: 123 }).success).toBe(false);
  });
});
