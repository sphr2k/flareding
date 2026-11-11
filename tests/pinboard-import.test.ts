import { describe, expect, it } from "vite-plus/test";
import { planPinboardImport } from "../src/import/pinboard.js";

const fixture = (overrides: Record<string, unknown> = {}) => ({
  href: "https://example.org/a",
  description: "An example",
  extended: "The original notes",
  time: "2009-07-08T10:20:30Z",
  shared: "no",
  toread: "yes",
  tags: "cloudflare  sqlite cloudflare",
  hash: "somehash",
  meta: "somemeta",
  ...overrides,
});

describe("private Pinboard JSON import planning", () => {
  it("maps full export record preserving timestamps and semantics", () => {
    const plan = planPinboardImport([fixture()]);
    expect(plan.stats).toMatchObject({
      received: 1,
      importable: 1,
      unsupported: 0,
      private: 1,
      unread: 1,
      distinctTags: 2,
      tagAssignments: 2,
      firstYear: 2009,
      lastYear: 2009,
    });
    expect(plan.entries).toEqual([
      {
        url: "https://example.org/a",
        title: "An example",
        description: "The original notes",
        notes: "",
        shared: false,
        unread: true,
        createdAt: new Date("2009-07-08T10:20:30Z"),
        tags: ["cloudflare", "sqlite"],
        metadata: { source: "pinboard", hash: "somehash", meta: "somemeta" },
      },
    ]);
  });

  it("separates unsupported schemes and refuses to turn script URLs into links", () => {
    const plan = planPinboardImport([
      fixture(),
      fixture({ href: "javascript:alert(1)" }),
      fixture({ href: "ftp://example.org/file" }),
      fixture({ href: "about:blank" }),
    ]);
    expect(plan.stats.importable).toBe(1);
    expect(plan.unsupported.map((u) => u.scheme)).toEqual(["javascript", "ftp", "about"]);
    expect(plan.unsupported.every((row) => !("url" in row))).toBe(true);
  });

  it("counts duplicates and invalid rows without exposing their contents", () => {
    const plan = planPinboardImport([fixture(), fixture(), fixture({ time: "not a date" })]);
    expect(plan.stats).toMatchObject({ received: 3, importable: 1, invalid: 1, duplicateUrls: 1 });
    expect(() => planPinboardImport({})).toThrow(/array/);
  });
});
