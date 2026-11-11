import { authenticateToken } from "../api/auth.js";
import type { Env } from "../env.js";
import { importBatchInput } from "./batch-schema.js";

const importPath = "/api/admin/pinboard-import/";
const finalizePath = "/api/admin/pinboard-finalize/";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

export function isImportAdminPath(path: string): boolean {
  return path === importPath || path === finalizePath;
}

async function authorizeAdmin(request: Request, env: Env): Promise<boolean> {
  // Require TWO independent high-entropy secrets. A web session is NEVER
  // sufficient to call the migration API, and a public linkding API token
  // without the second secret also cannot import private records.
  if ((await authenticateToken(request, env.API_TOKEN)) !== "ok") return false;
  if (!env.IMPORT_SECRET || env.IMPORT_SECRET.length < 32) return false;
  const provided = request.headers.get("X-Flareding-Import-Key");
  if (!provided || provided.length > 512) return false;
  const alternate = new Request(request.url, {
    headers: { Authorization: `Token ${provided}` },
  });
  return (await authenticateToken(alternate, env.IMPORT_SECRET)) === "ok";
}

async function restrictedJson(request: Request): Promise<unknown> {
  // Minimize parsing/memory risk even if an authenticated admin script sends
  // a huge payload. 50 records usually total << 256 KiB.
  const maxBytes = 512 * 1024;
  if (Number(request.headers.get("Content-Length") ?? "0") > maxBytes)
    throw new RangeError("Too much import data");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new RangeError("Too much import data");
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handlePinboardAdmin(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (!isImportAdminPath(path))
    return Response.json({ detail: "Not found." }, { status: 404, headers });
  if (!(await authorizeAdmin(request, env)))
    return Response.json({ detail: "Not found." }, { status: 404, headers });

  const doStub = env.BOOKMARKS.getByName("default");
  const query = new URL(request.url).searchParams;

  if (path === importPath && request.method === "GET") {
    const runId = query.get("runId") ?? "";
    if (!/^[0-9a-f]{64}$/.test(runId))
      return Response.json({ detail: "Invalid run ID" }, { status: 400, headers });
    return Response.json(await doStub.pinboardImportStats(runId), { headers });
  }

  if (path === importPath && request.method === "POST") {
    let data: unknown;
    try {
      data = await restrictedJson(request);
    } catch {
      return Response.json({ detail: "Invalid import payload" }, { status: 400, headers });
    }
    const parsed = importBatchInput.safeParse(data);
    if (!parsed.success)
      return Response.json({ detail: "Invalid import records" }, { status: 400, headers });
    try {
      const result = await doStub.importPinboardBatch(parsed.data);
      return Response.json(result, { headers });
    } catch (error) {
      if (error instanceof Error && error.message.includes("IMPORT_CHECKPOINT_CONFLICT"))
        return Response.json(
          { detail: "Import batch checkpoint conflict" },
          { status: 409, headers },
        );
      if (error instanceof Error && error.message.includes("IMPORT_DIGEST_INVALID"))
        return Response.json({ detail: "Import batch digest mismatch" }, { status: 400, headers });
      throw error;
    }
  }

  if (path === finalizePath && request.method === "POST") {
    let data: unknown;
    try {
      data = await restrictedJson(request);
    } catch {
      return Response.json({ detail: "Invalid finalization payload" }, { status: 400, headers });
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      return Response.json({ detail: "Invalid finalization payload" }, { status: 400, headers });
    const obj = data as Record<string, unknown>;
    const runId = obj.runId;
    const expected = obj.expected;
    if (
      typeof runId !== "string" ||
      !/^[0-9a-f]{64}$/.test(runId) ||
      !expected ||
      typeof expected !== "object" ||
      Array.isArray(expected)
    )
      return Response.json({ detail: "Invalid finalization payload" }, { status: 400, headers });
    const compare = expected as Record<string, unknown>;
    const report = await doStub.pinboardImportStats(runId);
    for (const key of [
      "totalBookmarks",
      "tagAssignments",
      "privateBookmarks",
      "unreadBookmarks",
      "importedRecords",
    ]) {
      if (compare[key] !== report[key as keyof typeof report])
        return Response.json({ detail: "Import verification failed" }, { status: 409, headers });
    }
    const orphanTagsRemoved = await doStub.pruneOrphanTags();
    return Response.json(
      {
        orphanTagsRemoved,
        stats: await doStub.pinboardImportStats(runId),
      },
      { headers },
    );
  }

  return Response.json({ detail: "Method not allowed" }, { status: 405, headers });
}
