/**
 * All presentation information derives from the origin hostname, never the
 * bookmark title or path. This is deterministic across CardView and ListView.
 * Do not fetch URL content or load remote assets from here.
 */
export function normalizeSiteHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function siteTone(host: string): number {
  let hash = 2166136261;
  for (const char of host) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 6;
}

export function siteMonogram(host: string): string {
  const root = host.split(".")[0] || "?";
  const codepoints = [...root].filter((char) => /[a-z0-9]/i.test(char));
  return (codepoints.slice(0, 2).join("") || "?").toUpperCase();
}

export function safeIconPath(url: string): string | null {
  const hostname = normalizeSiteHost(url);
  return hostname ? `/site-icons/${encodeURIComponent(hostname)}` : null;
}

/**
 * Inert, self-contained SVG for native Spectrum ListView's direct Image slot.
 * Colors are selected from a small, contrast-checked dark palette; host
 * monograms are strictly alphanumeric and cannot inject markup.
 */
export function fallbackIconDataUrl(url: string): string {
  const host = normalizeSiteHost(url) ?? "?";
  const backgrounds = ["#21416a", "#453069", "#1f4a3e", "#683b20", "#174a50", "#663151"];
  const bg = backgrounds[siteTone(host)];
  const text = siteMonogram(host);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">` +
    `<rect width="40" height="40" rx="9" fill="${bg}"/>` +
    `<text x="20" y="26" text-anchor="middle" font-size="15" font-weight="700" fill="#fff" font-family="Arial,sans-serif">${text}</text>` +
    "</svg>";
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
