import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

/** Catch regressions that left the full-page Spectrum 2 dark theme half-white. */
describe("Spectrum 2 full-page theme", () => {
  it("sets the root color scheme before React hydrates", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain('data-color-scheme="dark"');
  });

  it("loads official Spectrum 2 page CSS instead of coloring only the Provider", () => {
    const main = readFileSync(new URL("../src/ui/main.tsx", import.meta.url), "utf8");
    expect(main).toContain("@react-spectrum/s2/page.css");
    expect(main).toContain("./page.css");
  });

  it("styles non-Spectrum text with the complete typography token", () => {
    const source = readFileSync(new URL("../src/ui/App.tsx", import.meta.url), "utf8");
    expect(source).toContain('font: "heading-xl"');
    expect(source).not.toContain('fontSize: "heading-xl"');
    expect(source).toContain('minHeight: "100dvh"');
  });
});
