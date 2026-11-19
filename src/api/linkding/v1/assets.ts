import type { Env } from "../../../env.js";
import { readLimited } from "../../../worker/site-icons.js";
import { bookmarkCreate, pageInput } from "./contract.js";
import { paginationLinks } from "./pagination.js";

const maxAssetBytes = 8 * 1024 * 1024;

function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function handleBookmarkAssets(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const singleFile = url.pathname === "/api/bookmarks/singlefile/";
  const match = /^\/api\/bookmarks\/(\d+)\/assets\/(?:(upload|\d+)(?:\/(download))?\/)?$/.exec(
    url.pathname,
  );
  if (!match && !singleFile) return null;

  const store = env.BOOKMARKS.getByName("default");
  const bookmarkId = Number(match?.[1]);
  const assetId = Number(match?.[2]);
  const notFound = () => reply({ detail: "Not found." }, 404);
  if (request.method === "POST" && (singleFile || (match?.[2] === "upload" && !match[3]))) {
    const type = request.headers.get("Content-Type") ?? "";
    if (!type.toLowerCase().startsWith("multipart/form-data;")) {
      return reply({ detail: "Expected multipart form data." }, 415);
    }
    const body = await readLimited(new Response(request.body), maxAssetBytes + 64 * 1024);
    if (!body) return reply({ detail: "Asset exceeds 8 MiB." }, 413);
    const form = await new Response(Uint8Array.from(body), { headers: { "Content-Type": type } })
      .formData()
      .catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return reply({ detail: "No file provided." }, 400);
    if (file.size > maxAssetBytes) return reply({ detail: "Asset exceeds 8 MiB." }, 413);
    const target = singleFile ? bookmarkCreate.shape.url.safeParse(form?.get("url")) : null;
    if (target && !target.success) return reply({ detail: "A valid URL is required." }, 400);
    const asset = await store.saveAsset(target?.success ? { url: target.data } : { bookmarkId }, {
      bytes: new Uint8Array(await file.arrayBuffer()),
      name: file.name.slice(0, 2048),
      contentType: singleFile ? "text/html" : file.type.slice(0, 128) || "application/octet-stream",
    });
    if (!asset) return notFound();
    return reply(singleFile ? { message: "Snapshot uploaded successfully." } : asset, 201);
  }

  if (!match || match[2] === "upload") return notFound();
  if (request.method === "GET" && !match[2]) {
    const { limit, offset } = pageInput.parse(Object.fromEntries(url.searchParams));
    const page = await store.listAssets(bookmarkId, limit, offset);
    return page
      ? reply({ ...page, ...paginationLinks(url.href, page.count, limit, offset) })
      : notFound();
  }
  if (request.method === "GET" && Number.isSafeInteger(assetId)) {
    const result = await store.getAsset(bookmarkId, assetId, Boolean(match[3]));
    if (!result) return notFound();
    if (!result.bytes) return reply(result.asset);
    return new Response(Uint8Array.from(result.bytes), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": result.asset.content_type,
        "Content-Disposition":
          "attachment; filename*=UTF-8''" +
          encodeURIComponent(result.asset.display_name.toWellFormed()).replace(
            /['()]/g,
            (char) => "%" + char.charCodeAt(0).toString(16),
          ),
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (request.method === "DELETE" && !match[3] && Number.isSafeInteger(assetId)) {
    return (await store.deleteAsset(bookmarkId, assetId))
      ? new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } })
      : notFound();
  }
  return reply({ detail: "Method not allowed." }, 405);
}
