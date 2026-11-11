import { describe, expect, it } from "vite-plus/test";
import {
  fallbackIconDataUrl,
  normalizeSiteHost,
  safeIconPath,
  siteMonogram,
  siteTone,
  trustedSiteIconSrc,
} from "../src/ui/lib/site-icon.js";

describe("bookmark SiteIcon host identity and deterministic fallback", () => {
  it("uses canonical origin host independent of path and case", () => {
    const a = normalizeSiteHost("https://WWW.Example.COM/alpha?token=not-an-icon-id");
    const b = normalizeSiteHost("https://example.com/beta");
    expect(a).toBe("example.com");
    expect(b).toBe(a);
    expect(siteTone(a!)).toBe(siteTone(b!));
    expect(safeIconPath("https://www.example.com/a")).toBe("/api/site-icons/example.com");
  });

  it("generates inert deterministic local SVG assets without network requests", () => {
    const a = fallbackIconDataUrl("https://www.example.org/foo");
    const b = fallbackIconDataUrl("https://example.org/bar");
    expect(a).toBe(b);
    expect(a.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(a)).toContain("EX");
    expect(decodeURIComponent(fallbackIconDataUrl("javascript:alert(1)"))).not.toContain("<script");
  });

  it("only accepts same-origin favicon image URLs", () => {
    const origin = "https://flareding.example";
    expect(trustedSiteIconSrc(origin + "/api/site-icons/github.com", origin)).toBe(
      origin + "/api/site-icons/github.com",
    );
    expect(trustedSiteIconSrc("/api/site-icons/github.com", origin)).toBe(
      origin + "/api/site-icons/github.com",
    );
    expect(
      trustedSiteIconSrc("https://attacker.example/api/site-icons/github.com", origin),
    ).toBeNull();
    expect(trustedSiteIconSrc("javascript:alert(1)", origin)).toBeNull();
    expect(trustedSiteIconSrc("/api/site-icons/github.com?u=bad", origin)).toBeNull();
  });

  it("denies non-HTTP(S) and invalid links", () => {
    expect(normalizeSiteHost("javascript:alert(1)")).toBeNull();
    expect(safeIconPath("file:///etc/passwd")).toBeNull();
    expect(normalizeSiteHost("not a link")).toBeNull();
  });

  it("gives a stable bounded palette and concise site monogram", () => {
    expect(siteTone("www.example.com")).toBe(siteTone("www.example.com"));
    expect(siteTone("example.com")).toBeGreaterThanOrEqual(0);
    expect(siteTone("example.com")).toBeLessThan(6);
    expect(siteMonogram("github.com")).toBe("GI");
    expect(siteMonogram("")).toBe("?");
  });
});
