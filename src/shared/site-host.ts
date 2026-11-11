/** The origin hostname (never the bookmark URL's path/query) is the icon key. */
export function normalizeSiteHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\.$/, "");
    return isPublicHostnameSyntax(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * Syntax-level validation only. DNS addresses and redirects MUST also be
 * checked before outbound fetch to prevent SSRF.
 */
export function isPublicHostnameSyntax(host: string): boolean {
  if (host.length < 4 || host.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (
    labels.some(
      (label) =>
        !label.length || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  )
    return false;
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) return false; // no IPv4 or numeric hostname tricks
  const reserved = new Set([
    "localhost",
    "local",
    "lan",
    "internal",
    "intranet",
    "corp",
    "home",
    "onion",
    "test",
    "invalid",
    "example",
    "arpa",
  ]);
  if (reserved.has(tld)) return false;
  if (host === "metadata.google.internal" || host.endsWith(".localhost")) return false;
  return true;
}

export function safeIconPath(url: string): string | null {
  const host = normalizeSiteHost(url);
  return host ? `/api/site-icons/${encodeURIComponent(host)}` : null;
}
