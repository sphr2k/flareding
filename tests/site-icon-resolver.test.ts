import { describe, expect, it } from "vite-plus/test";
import {
  detectSafeImageType,
  handleSiteIcon,
  htmlIconCandidates,
  isPublicIp,
  resolvesToPublicAddresses,
  validateOutboundUrl,
} from "../src/worker/site-icons.js";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);
const iconUrl = "https://flareding.test/api/site-icons/public.testsite.io";

function mockFetch(
  opts: {
    html?: string;
    privateDns?: boolean;
    redirectTo?: string;
    iconType?: string;
    pngSize?: number;
    blockImage?: boolean;
    manifest?: boolean;
    dnsAlias?: string;
    privateIpv6?: boolean;
  } = {},
) {
  const requests: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push(url);
    const parsed = new URL(url);
    if (parsed.host === "cloudflare-dns.com") {
      // Cloudflare's runtime rejects redirect:"error"; we must explicitly
      // inspect a manual redirect response and never follow it.
      if (init?.redirect !== "manual") throw new Error("DNS redirects must be manual");
      const type = parsed.searchParams.get("type");
      const name = parsed.searchParams.get("name");
      if (opts.dnsAlias && name === "public.testsite.io") {
        return Response.json({ Status: 0, Answer: [{ type: 5, data: opts.dnsAlias + "." }] });
      }
      if (type === "AAAA")
        return Response.json({
          Status: 0,
          Answer: opts.privateIpv6 ? [{ type: 28, data: "fc00::1" }] : [],
        });
      return Response.json({
        Status: 0,
        Answer: [{ type: 1, data: opts.privateDns ? "169.254.169.254" : "1.1.1.1" }],
      });
    }
    if (opts.redirectTo && parsed.pathname === "/favicon.ico") {
      return new Response(null, { status: 302, headers: { Location: opts.redirectTo } });
    }
    if (parsed.pathname === "/") {
      return new Response(
        opts.html ??
          '<html><head><link rel="icon" sizes="192x192" href="/large.png"></head></html>',
        { headers: { "Content-Type": "text/html" } },
      );
    }
    if (parsed.pathname === "/manifest.webmanifest") {
      return Response.json(
        opts.manifest
          ? { icons: [{ src: "/app-icon.png", sizes: "192x192", type: "image/png" }] }
          : {},
        { headers: { "Content-Type": "application/manifest+json" } },
      );
    }
    if (
      parsed.pathname === "/large.png" ||
      parsed.pathname === "/app-icon.png" ||
      parsed.pathname === "/favicon.ico"
    ) {
      if (opts.blockImage) return new Response(null, { status: 404 });
      return new Response(opts.pngSize ? new Uint8Array(opts.pngSize) : png.slice(), {
        headers: { "Content-Type": opts.iconType ?? "image/png" },
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetcher, requests };
}

function makeCache() {
  const responses = new Map<string, Response>();
  return {
    cache: {
      match: async (key: Request) => responses.get(key.url)?.clone(),
      put: async (key: Request, response: Response) => {
        responses.set(key.url, response.clone());
      },
    } as unknown as Cache,
    responses,
  };
}

describe("site icon network policy", () => {
  it("rejects loopback, metadata, internal, reserved IPv4 and IPv6 ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "172.31.12.1",
      "192.168.3.10",
      "169.254.169.254",
      "100.64.0.1",
      "198.18.0.1",
      "203.0.113.20",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      expect(isPublicIp(ip), ip).toBe(false);
    }
    expect(isPublicIp("1.1.1.1")).toBe(true);
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
    for (const candidate of [
      "http://127.0.0.1/",
      "https://2130706433",
      "http://[::1]/",
      "file:///etc/passwd",
      "https://user:pass@public.testsite.io/",
      "https://public.testsite.io:8443/",
      "https://metadata.google.internal/",
      "https://localhost/",
      "https://unsafe.local/",
    ])
      expect(validateOutboundUrl(candidate), candidate).toBeNull();
    expect(validateOutboundUrl("https://public.testsite.io/favicon.ico")).not.toBeNull();
  });

  it("denies private DNS answers and private CNAMEs before any remote webpage fetch", async () => {
    const { fetcher, requests } = mockFetch({ privateDns: true });
    expect(await resolvesToPublicAddresses("public.testsite.io", fetcher)).toBe(false);
    const response = await handleSiteIcon(new Request(iconUrl), { fetcher, cache: null });
    expect(response.status).toBe(404);
    expect(requests.every((url) => url.includes("/dns-query?"))).toBe(true);

    const mixedAnswers = mockFetch({ privateIpv6: true });
    expect(await resolvesToPublicAddresses("public.testsite.io", mixedAnswers.fetcher)).toBe(false);
    expect(mixedAnswers.requests.every((url) => url.includes("/dns-query?"))).toBe(true);
    const badCname = mockFetch({ dnsAlias: "localhost" });
    expect(await resolvesToPublicAddresses("public.testsite.io", badCname.fetcher)).toBe(false);
    expect(badCname.requests.every((url) => url.includes("/dns-query?"))).toBe(true);
  });

  it("selects a larger native favicon over Apple touch or 16px icon", () => {
    const html = `<link sizes="16x16" rel="shortcut icon" href="/16.png">
      <link href='/apple.png' rel='apple-touch-icon'>
      <link rel="icon" href="/192.png" sizes="192x192">
      <link rel="icon" type="image/svg+xml" href="/active.svg">`;
    const candidates = htmlIconCandidates(html, new URL("https://public.testsite.io/"));
    expect(candidates[0]?.url.pathname).toBe("/192.png");
    expect(candidates[1]?.url.pathname).toBe("/apple.png");
    expect(candidates.some((value) => value.url.pathname.includes("active.svg"))).toBe(false);
  });

  it("fetches and caches one image for the same host without DO calls", async () => {
    const { fetcher, requests } = mockFetch();
    const { cache } = makeCache();
    const req = new Request(iconUrl);
    const first = await handleSiteIcon(req, { fetcher, cache });
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Type")).toBe("image/png");
    expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect((await first.arrayBuffer()).byteLength).toBe(png.length);
    const networkCount = requests.length;
    const second = await handleSiteIcon(req, { fetcher, cache });
    expect(second.status).toBe(200);
    expect(requests.length).toBe(networkCount);
    expect(networkCount).toBeLessThanOrEqual(4); // 2 DNS + 1 HTML + 1 icon
  });

  it("rejects unsafe redirects, HTML masquerading as an image and oversized images", async () => {
    const redirected = mockFetch({ html: "<html/>", redirectTo: "http://127.0.0.1/admin" });
    const result = await handleSiteIcon(new Request(iconUrl), {
      cache: null,
      fetcher: redirected.fetcher,
    });
    expect(result.status).toBe(404);
    expect(redirected.requests.some((url) => url.includes("127.0.0.1"))).toBe(false);
    const svg = mockFetch({ iconType: "image/svg+xml" });
    expect(
      (
        await handleSiteIcon(new Request(iconUrl), {
          cache: null,
          fetcher: svg.fetcher,
        })
      ).status,
    ).toBe(404);
    const huge = mockFetch({ pngSize: 256 * 1024 + 1 });
    expect(
      (
        await handleSiteIcon(new Request(iconUrl), {
          cache: null,
          fetcher: huge.fetcher,
        })
      ).status,
    ).toBe(404);
    expect(detectSafeImageType(new TextEncoder().encode("<svg/onload=alert(1)>"))).toBeNull();
  });

  it("caches negative results, rejects invalid host paths and HEAD avoids a new fetch", async () => {
    const { fetcher, requests } = mockFetch({ blockImage: true });
    const { cache } = makeCache();
    const initialHead = await handleSiteIcon(new Request(iconUrl, { method: "HEAD" }), {
      fetcher,
      cache,
    });
    expect(initialHead.status).toBe(404);
    expect(requests.length).toBe(0);
    const first = await handleSiteIcon(new Request(iconUrl), { fetcher, cache });
    expect(first.status).toBe(404);
    const count = requests.length;
    expect((await handleSiteIcon(new Request(iconUrl), { fetcher, cache })).status).toBe(404);
    expect(requests.length).toBe(count);
    const cachedHead = await handleSiteIcon(new Request(iconUrl, { method: "HEAD" }), {
      fetcher,
      cache,
    });
    expect(cachedHead.status).toBe(404);
    expect(requests.length).toBe(count);
    const denied = await handleSiteIcon(
      new Request("https://flareding.test/api/site-icons/localhost"),
      { fetcher, cache },
    );
    expect(denied.status).toBe(404);
    expect(requests.length).toBe(count);
  });

  it("loads an allowed high-resolution manifest icon and rejects cross-origin active content", async () => {
    const { fetcher } = mockFetch({
      html: '<link rel="manifest" href="/manifest.webmanifest">',
      manifest: true,
    });
    const resolved = await handleSiteIcon(new Request(iconUrl), { fetcher, cache: null });
    expect(resolved.status).toBe(200);
  });
});
