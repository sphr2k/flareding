/**
 * All presentation information derives from the origin hostname, never the
 * bookmark title or path. This is deterministic across CardView and ListView.
 * Do not fetch URL content or load remote assets from here.
 */
import { normalizeSiteHost } from "../../shared/site-host.js";
export { normalizeSiteHost, safeIconPath } from "../../shared/site-host.js";

export function siteTone(host: string): number {
  let hash = 2166136261;
  for (const char of host
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "")) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 9;
}

export function siteMonogram(host: string): string {
  const root = host.split(".")[0] || "?";
  const codepoints = [...root].filter((char) => /[a-z0-9]/i.test(char));
  return (codepoints.slice(0, 2).join("") || "?").toUpperCase();
}

/**
 * Inert, self-contained SVG for native Spectrum ListView's direct Image slot.
 * Colors use the same restrained domain palette as CardView; host
 * monograms are strictly alphanumeric and cannot inject markup.
 */
export function fallbackIconDataUrl(url: string): string {
  const host = normalizeSiteHost(url) ?? "?";
  const bg = `hsl(${getSiteColor(host).hue} 10% 20%)`;
  const text = siteMonogram(host);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">` +
    `<rect width="40" height="40" rx="9" fill="${bg}"/>` +
    `<text x="20" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="#fff" font-family="Arial,sans-serif">${text}</text>` +
    "</svg>";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Allow images only from the authenticated Same-Origin favicon endpoint. */
export function trustedSiteIconSrc(candidate: string | null, appOrigin: string): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate, appOrigin);
    if (
      url.origin !== new URL(appOrigin).origin ||
      url.search ||
      url.hash ||
      !/^\/api\/site-icons\/[a-z0-9.-]+$/.test(url.pathname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Curated, low-saturation domain palette shared by every bookmark view. */
const siteColors = [
  { name: "Blue", hue: 215 },
  { name: "Cyan", hue: 190 },
  { name: "Teal", hue: 170 },
  { name: "Green", hue: 140 },
  { name: "Olive", hue: 85 },
  { name: "Amber", hue: 40 },
  { name: "Red", hue: 5 },
  { name: "Purple", hue: 270 },
  { name: "Magenta", hue: 320 },
] as const;

export function getSiteColor(hostname: string) {
  return siteColors[siteTone(hostname)];
}

/** Approved S2 exception: transparent wash preserves native surface/states. */
export function siteCardBackground(host: string, accent?: number | null): string {
  if (accent === null) return "none";
  return `linear-gradient(135deg, hsl(${accent ?? getSiteColor(host).hue} 35% 60% / 0.07), transparent)`;
}
