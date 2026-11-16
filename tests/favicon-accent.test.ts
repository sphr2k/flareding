import { describe, expect, it } from "vite-plus/test";
import { extractAccent, needsLightBacking } from "../src/ui/lib/favicon-accent.js";
import { siteCardBackground } from "../src/ui/lib/site-icon.js";

describe("favicon accents", () => {
  it("ignores transparent and monochrome pixels", () => {
    expect(
      extractAccent([0, 0, 0, 255, 255, 255, 255, 255, 120, 120, 120, 255, 0, 0, 255, 0]),
    ).toBeNull();
    expect(siteCardBackground("github.com", null)).toBe("none");
  });
  it("backs nearly black transparent and opaque icons with a light tile", () => {
    const dark = [0, 0, 0, 255, 18, 18, 18, 0, 0, 0, 0, 0, 20, 20, 20, 0];
    expect(needsLightBacking(dark)).toBe(false); // only one opaque pixel
    expect(needsLightBacking(Array(20).fill([18, 18, 18, 255]).flat())).toBe(true);
    expect(
      needsLightBacking([
        ...Array(20).fill([18, 18, 18, 255]).flat(),
        ...Array(10).fill([235, 235, 235, 255]).flat(),
      ]),
    ).toBe(false); // dark logo already has visibly bright details
    expect(needsLightBacking(Array(20).fill([230, 230, 230, 255]).flat())).toBe(false);
    expect(needsLightBacking(Array(20).fill([8, 8, 8, 0]).flat())).toBe(false);
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
