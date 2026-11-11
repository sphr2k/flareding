import { isPublicHostnameSyntax } from "../shared/site-host.js";

/**
 * Site icons are independent of bookmark data. Requests never query the DO.
 * Only hosts from an authenticated bookmark page may reach this endpoint.
 */
const POSITIVE_TTL = 7 * 24 * 3600;
const NEGATIVE_TTL = 12 * 3600;
const MAX_HTML_BYTES = 96 * 1024;
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_DNS_BYTES = 10 * 1024;
const MAX_REDIRECTS = 2;
const MAX_CANDIDATES = 5;
const TIMEOUT_MS = 3000;

type Requester = typeof fetch;
type CacheStore = Pick<Cache, "match" | "put">;

export interface IconResolverDependencies {
  fetcher?: Requester;
  cache?: CacheStore | null;
  /** For tests, or when a Worker request context owns the async cache write. */
  waitUntil?: (promise: Promise<unknown>) => void;
}

function publicIPv4(address: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)) return false;
  const ip = address.split(".").map(Number);
  if (ip.some((part) => part > 255)) return false;
  const [a, b, c] = ip;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/** Only globally routable IPv6 unicast; deny mapped/tunneled/documentation. */
function publicIPv6(address: string): boolean {
  // Canonicalize through URL's standards-compliant IPv6 parser so alternate
  // representations such as 2001:0db8::1 cannot bypass reserved prefixes.
  if (address.includes("%") || address.includes(".")) return false;
  let ip: string;
  try {
    const normalized = new URL(`https://[${address}]/`).hostname;
    ip = normalized.slice(1, -1);
  } catch {
    return false;
  }
  const first = parseInt(ip.split(":")[0] || "0", 16);
  if (!(first >= 0x2000 && first <= 0x3fff)) return false;
  if (ip.startsWith("2001:db8:") || ip.startsWith("2001:db8::")) return false;
  if (ip.startsWith("2001:0:") || ip.startsWith("2001::")) return false; // Teredo
  if (ip.startsWith("2002:")) return false; // IPv4 encapsulation
  return true;
}

export function isPublicIp(address: string): boolean {
  return publicIPv4(address) || publicIPv6(address);
}

export function validateOutboundUrl(raw: string): URL | null {
  if (raw.length > 1600) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (url.username || url.password || url.port) return null;
  if (!isPublicHostnameSyntax(url.hostname.toLowerCase())) return null;
  return url;
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const len = response.headers.get("Content-Length");
  if (len && Number(len) > maxBytes) {
    await response.body.cancel().catch(() => {});
    return null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(chunk.value);
    }
    const output = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } finally {
    reader.releaseLock();
  }
}

interface DnsResponse {
  Status?: number;
  Answer?: Array<{ type?: number; data?: string }>;
}

async function queryDns(
  host: string,
  type: "A" | "AAAA",
  requester: Requester,
): Promise<Array<{ type: number; data: string }> | null> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`;
  const response = await requester(url, {
    redirect: "manual",
    headers: { Accept: "application/dns-json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = await readLimited(response, MAX_DNS_BYTES);
  if (!payload) return null;
  let parsed: DnsResponse;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payload)) as DnsResponse;
  } catch {
    return null;
  }
  if (parsed.Status !== 0 || !Array.isArray(parsed.Answer)) return null;
  return parsed.Answer.filter(
    (answer): answer is { type: number; data: string } =>
      typeof answer.type === "number" && typeof answer.data === "string",
  );
}

/**
 * Fail closed on private/reserved IPs in *any* A/AAAA/CNAME response.
 * Recheck every redirect target. DNS rebinding is not fully preventable by
 * a preflight alone, so this route also requires the normal browser session
 * or API token at the Worker boundary.
 */
export async function resolvesToPublicAddresses(
  host: string,
  requester: Requester,
): Promise<boolean> {
  if (!isPublicHostnameSyntax(host)) return false;
  const visited = new Set<string>();
  const queue = [host];
  let traversals = 0;
  let addresses = 0;
  while (queue.length && traversals++ < 5) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (!isPublicHostnameSyntax(current)) return false;
    let answerA: Awaited<ReturnType<typeof queryDns>>;
    let answerAAAA: Awaited<ReturnType<typeof queryDns>>;
    try {
      [answerA, answerAAAA] = await Promise.all([
        queryDns(current, "A", requester),
        queryDns(current, "AAAA", requester),
      ]);
    } catch {
      return false;
    }
    if (!answerA && !answerAAAA) return false;
    for (const answer of [...(answerA ?? []), ...(answerAAAA ?? [])]) {
      if (answer.type === 1 || answer.type === 28) {
        if (!isPublicIp(answer.data)) return false;
        addresses++;
      } else if (answer.type === 5) {
        const alias = answer.data.toLowerCase().replace(/\.$/, "");
        if (!isPublicHostnameSyntax(alias) || visited.has(alias)) return false;
        if (!queue.includes(alias)) queue.push(alias);
      }
    }
  }
  return !queue.length && addresses > 0;
}

async function fetchChecked(
  target: URL,
  requester: Requester,
  validatedHosts: Map<string, boolean>,
): Promise<{ url: URL; response: Response } | null> {
  let next = target;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const safe = validateOutboundUrl(next.toString());
    if (!safe) return null;
    let allowed = validatedHosts.get(safe.hostname);
    if (allowed === undefined) {
      allowed = await resolvesToPublicAddresses(safe.hostname, requester);
      validatedHosts.set(safe.hostname, allowed);
    }
    if (!allowed) return null;
    let response: Response;
    try {
      response = await requester(safe.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Accept:
            "image/avif,image/webp,image/png,image/jpeg,image/x-icon,text/html,application/json;q=0.8",
          "User-Agent": "Flareding-SiteIcon/1.0",
        },
      });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      await response.body?.cancel().catch(() => {});
      if (!location || redirects === MAX_REDIRECTS) return null;
      try {
        next = new URL(location, safe);
      } catch {
        return null;
      }
      continue;
    }
    return { url: safe, response };
  }
  return null;
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4]).trim();
  }
  return attrs;
}

interface IconCandidate {
  url: URL;
  score: number;
}

function extensionIsSvg(url: URL): boolean {
  return /\.svg$/i.test(url.pathname);
}

export function htmlIconCandidates(html: string, origin: URL): IconCandidate[] {
  const icons: IconCandidate[] = [];
  const manifests: URL[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = parseHtmlAttributes(tag);
    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
    const href = attrs.href;
    if (!href || href.length > 1200) continue;
    let url: URL;
    try {
      url = new URL(href.replace(/&amp;/g, "&"), origin);
    } catch {
      continue;
    }
    if (!validateOutboundUrl(url.toString()) || extensionIsSvg(url)) continue;
    if (rel.includes("manifest")) {
      manifests.push(url);
      continue;
    }
    const isIcon = rel.includes("icon") || rel.includes("shortcut");
    const isApple = rel.some((label) => label.startsWith("apple-touch-icon"));
    if (!isIcon && !isApple) continue;
    const declared = (attrs.sizes ?? "").match(/^(\d+)[xX](\d+)$/);
    const dimension = declared ? Math.min(Number(declared[1]), Number(declared[2])) : 0;
    let score = isApple ? 120 : dimension >= 96 ? 170 : dimension >= 32 ? 75 : 50;
    if (dimension >= 180) score += 10;
    if ((attrs.type ?? "").includes("svg")) score = -1;
    if (score >= 0) icons.push({ url, score });
  }
  icons.sort((a, b) => b.score - a.score);
  // Manifest is read separately (bounded once), before fallback /favicon.ico.
  return icons.slice(0, MAX_CANDIDATES);
}

function manifestUrlFromHtml(html: string, origin: URL): URL | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = parseHtmlAttributes(tag);
    if (!attrs.rel?.toLowerCase().split(/\s+/).includes("manifest") || !attrs.href) continue;
    try {
      const url = new URL(attrs.href.replace(/&amp;/g, "&"), origin);
      if (validateOutboundUrl(url.toString())) return url;
    } catch {
      /* Invalid manifest */
    }
  }
  return null;
}

function iconFromManifest(bytes: Uint8Array, origin: URL): IconCandidate | null {
  let manifest: { icons?: Array<{ src?: string; sizes?: string; type?: string }> };
  try {
    manifest = JSON.parse(new TextDecoder().decode(bytes)) as typeof manifest;
  } catch {
    return null;
  }
  if (!Array.isArray(manifest.icons)) return null;
  const options: IconCandidate[] = [];
  for (const item of manifest.icons.slice(0, 12)) {
    if (!item.src || (item.type ?? "").includes("svg")) continue;
    try {
      const url = new URL(item.src, origin);
      if (!validateOutboundUrl(url.toString()) || extensionIsSvg(url)) continue;
      const dimension = Number(item.sizes?.match(/\d+/)?.[0] ?? "0");
      options.push({ url, score: dimension >= 96 ? 150 : 55 });
    } catch {
      /* malformed URL */
    }
  }
  options.sort((a, b) => b.score - a.score);
  return options[0] ?? null;
}

export function detectSafeImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return "image/x-icon";
  return null;
}

async function obtainSafeImage(
  target: URL,
  requester: Requester,
  validatedHosts: Map<string, boolean>,
): Promise<{ type: string; bytes: Uint8Array } | null> {
  const fetched = await fetchChecked(target, requester, validatedHosts);
  if (!fetched || !fetched.response.ok) return null;
  const contentType = (fetched.response.headers.get("Content-Type") ?? "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/x-icon",
      "image/vnd.microsoft.icon",
      "application/octet-stream",
      "",
    ].includes(contentType)
  ) {
    await fetched.response.body?.cancel().catch(() => {});
    return null;
  }
  const bytes = await readLimited(fetched.response, MAX_IMAGE_BYTES);
  if (!bytes) return null;
  const type = detectSafeImageType(bytes);
  if (!type) return null;
  return { type, bytes };
}

async function discoverSiteIcon(host: string, requester: Requester): Promise<Response> {
  const checkedHosts = new Map<string, boolean>();
  const homepage = validateOutboundUrl(`https://${host}/`);
  if (!homepage) return missingIcon();
  let candidates: IconCandidate[] = [];
  let manifest: URL | null = null;
  const fetched = await fetchChecked(homepage, requester, checkedHosts);
  if (
    fetched?.response.ok &&
    (fetched.response.headers.get("Content-Type") ?? "").toLowerCase().includes("text/html")
  ) {
    const bytes = await readLimited(fetched.response, MAX_HTML_BYTES);
    if (bytes) {
      const html = new TextDecoder().decode(bytes);
      candidates = htmlIconCandidates(html, fetched.url);
      manifest = manifestUrlFromHtml(html, fetched.url);
    }
  } else {
    await fetched?.response.body?.cancel().catch(() => {});
  }
  if (manifest) {
    const manifestData = await fetchChecked(manifest, requester, checkedHosts);
    if (
      manifestData?.response.ok &&
      (manifestData.response.headers.get("Content-Type") ?? "").toLowerCase().includes("json")
    ) {
      const bytes = await readLimited(manifestData.response, MAX_MANIFEST_BYTES);
      if (bytes) {
        const entry = iconFromManifest(bytes, manifestData.url);
        if (entry) candidates.push(entry);
      }
    } else {
      await manifestData?.response.body?.cancel().catch(() => {});
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const fallback = validateOutboundUrl(`https://${host}/favicon.ico`);
  if (fallback) candidates.push({ url: fallback, score: 0 });
  const attempted = new Set<string>();
  for (const candidate of candidates.slice(0, MAX_CANDIDATES + 1)) {
    if (attempted.has(candidate.url.href)) continue;
    attempted.add(candidate.url.href);
    const image = await obtainSafeImage(candidate.url, requester, checkedHosts);
    if (image) {
      const body = new ArrayBuffer(image.bytes.byteLength);
      new Uint8Array(body).set(image.bytes);
      return new Response(body, {
        headers: {
          "Content-Type": image.type,
          "Cache-Control": `public, max-age=86400, s-maxage=${POSITIVE_TTL}`,
          "X-Content-Type-Options": "nosniff",
          "Cross-Origin-Resource-Policy": "same-origin",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
  }
  return missingIcon();
}

function missingIcon(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": `public, max-age=900, s-maxage=${NEGATIVE_TTL}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Only a numeric concurrency guard is shared across isolate invocations.
// Never share fetch promises or Response bodies between Worker requests:
// Cloudflare I/O operations are bound to their originating request context.
let activeResolvers = 0;
const MAX_ACTIVE_RESOLVERS = 32;

/**
 * The caller MUST authenticate before invoking the resolver. Each request
 * owns its network I/O; host-only browser URLs and the Cloudflare Cache API
 * deduplicate fetched images without crossing request-bound I/O contexts.
 * Cached responses contain only public image bytes, not bookmark data.
 */
export async function handleSiteIcon(
  request: Request,
  dependencies: IconResolverDependencies = {},
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const url = new URL(request.url);
  const match = /^\/api\/site-icons\/([^/]+)$/.exec(url.pathname);
  if (!match) return missingIcon();
  let host: string;
  try {
    host = decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return missingIcon();
  }
  if (!isPublicHostnameSyntax(host)) return missingIcon();

  const cache =
    dependencies.cache === undefined
      ? typeof caches === "undefined"
        ? null
        : (caches as CacheStorage & { default: Cache }).default
      : dependencies.cache;
  const cacheUrl = new URL(url);
  cacheUrl.search = ""; // no cache fragmentation from arbitrary query strings
  const cacheKey = new Request(cacheUrl.toString());
  if (cache) {
    try {
      const found = await cache.match(cacheKey);
      if (found)
        return request.method === "HEAD"
          ? new Response(null, { status: found.status, headers: found.headers })
          : found;
    } catch {
      /* Cache is best-effort; never block icon rendering. */
    }
  }

  // A HEAD probe must never initiate a remote crawl on an uncached host.
  if (request.method === "HEAD") return new Response(null, { status: 404 });

  if (activeResolvers >= MAX_ACTIVE_RESOLVERS) {
    return new Response(null, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "2" },
    });
  }
  activeResolvers++;
  let response: Response;
  try {
    response = await discoverSiteIcon(host, dependencies.fetcher ?? fetch);
  } catch {
    response = missingIcon();
  } finally {
    activeResolvers--;
  }
  if (cache) {
    const saved = cache.put(cacheKey, response.clone()).catch(() => {});
    dependencies.waitUntil?.(saved);
    if (!dependencies.waitUntil) await saved;
  }
  return response;
}
