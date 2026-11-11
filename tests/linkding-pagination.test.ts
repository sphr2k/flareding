import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { pageInput } from "../src/api/bookmark-contract.js";
import { paginationLinks } from "../src/api/pagination.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/linkding-pagination.json", import.meta.url), "utf8"),
) as {
  count: number;
  cases: {
    query: string;
    limit: number;
    offset: number;
    next: string | null;
    previous: string | null;
  }[];
};
describe("linkding v1.47.0 / DRF 3.17.2 reference pagination", () => {
  for (const sample of fixture.cases) {
    it(sample.query || "defaults", () => {
      const url = new URL(`https://reference.example/api/tags/?${sample.query}`);
      const input = pageInput.parse(Object.fromEntries(url.searchParams));
      expect(input.limit).toBe(sample.limit);
      expect(input.offset).toBe(sample.offset);
      expect(paginationLinks(url.href, fixture.count, input.limit, input.offset)).toEqual({
        next: sample.next,
        previous: sample.previous,
      });
    });
  }
});
