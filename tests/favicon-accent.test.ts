import { describe, expect, it } from "vite-plus/test";
import { extractAccent } from "../src/ui/lib/favicon-accent.js";
import { siteCardBackground } from "../src/ui/lib/site-icon.js";

describe("favicon accents", () => {
  it("ignores transparent and monochrome pixels", () => {
    expect(
      extractAccent([0, 0, 0, 255, 255, 255, 255, 255, 120, 120, 120, 255, 0, 0, 255, 0]),
    ).toBeNull();
    expect(siteCardBackground("github.com", null)).toBe("none");
  });
  it("selects a chromatic hue instead of averaging white into it", () => {
    const pixels = [
      ...Array(8).fill([255, 255, 255, 255]).flat(),
      ...Array(4).fill([0, 100, 255, 255]).flat(),
    ];
    expect(extractAccent(pixels)).toBeGreaterThan(210);
    expect(extractAccent(pixels)).toBeLessThan(220);
    expect(siteCardBackground("example.org", 215)).toContain("215");
    expect(siteCardBackground("example.org")).toContain("0.07");
  });
});
