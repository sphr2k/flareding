import { stableJson } from "../src/import/digest.ts";
/** Real workerd integration tests through cf dev, not SQLite mocks.
 * Uses an ephemeral token and an isolated Worker port.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const devVars = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
const localToken = /^API_TOKEN=(.+)$/m.exec(devVars)?.[1];
const token = localToken ?? randomBytes(48).toString("base64url");
const localImportSecret = /^IMPORT_SECRET=(.+)$/m.exec(devVars)?.[1];
const importSecret = localImportSecret ?? randomBytes(48).toString("base64url");
const port = Number(process.env.FLAREDING_TEST_PORT ?? 8797);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(
  "cf",
  ["dev", "--mode", "staging-import", "--", "--host", "127.0.0.1", "--port", String(port)],
  {
    cwd: process.cwd(),
    env: { ...process.env, API_TOKEN: token, IMPORT_SECRET: importSecret },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    logs += chunk;
    if (logs.length > 10_000) logs = logs.slice(-10_000);
  });
}
function stop() {
  if (child.exitCode !== null) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    // Already stopped.
  }
}
async function request(method, path, payload, authorize = true) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      ...(authorize ? { Authorization: `Token ${token}` } : {}),
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  let body;
  const raw = await response.text();
  if (raw) body = JSON.parse(raw);
  return { status: response.status, body };
}
function expectStatus(result, expected, label) {
  assert.equal(result.status, expected, `${label}: ${JSON.stringify(result.body)}`);
}
try {
  let ready = false;
  for (let i = 0; i < 70; i++) {
    if (child.exitCode !== null) throw new Error("cf dev exited before ready");
    try {
      const health = await request("GET", "/api/health", undefined, false);
      if (health.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Dev server startup */
    }
    await delay(300);
  }
  if (!ready) throw new Error("Timed out starting real local SQLite DO");

  expectStatus(await request("GET", "/api/bookmarks/", undefined, false), 401, "anonymous read");
  const unconfiguredAccess = await fetch(origin + "/auth/access/session", {
    method: "POST",
    headers: { Origin: origin },
  });
  assert.equal(
    unconfiguredAccess.status,
    503,
    "Access login must remain disabled without configured identity",
  );

  const login = await fetch(origin + "/api/session/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ token }),
  });
  assert.equal(login.status, 200, "session login");
  const setCookie = login.headers.get("Set-Cookie") ?? "";
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  assert.ok(!setCookie.includes(token));
  const cookie = setCookie.split(";")[0];
  const session = await fetch(origin + "/api/session/", {
    headers: { Cookie: cookie },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).authenticated, true);
  const cookieList = await fetch(origin + "/api/bookmarks/", {
    headers: { Cookie: cookie },
  });
  assert.equal(cookieList.status, 200, "browser session can read bookmarks");
  const csrf = await fetch(origin + "/api/bookmarks/1/", {
    method: "PATCH",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: "https://untrusted.example",
    },
    body: JSON.stringify({ notes: "should-not-write" }),
  });
  assert.equal(csrf.status, 403, "cookie-auth mutations must reject cross-origin");

  const unauthorized = await fetch(origin + "/api/bookmarks/", {
    headers: { Authorization: "Token incorrect" },
  });
  assert.equal(unauthorized.status, 401);

  const invalidLink = await request("POST", "/api/bookmarks/", {
    url: "javascript:alert(1)",
    title: "A script URL must never become a bookmark",
  });
  assert.ok(
    [400, 422].includes(invalidLink.status),
    `Unsafe URL must be rejected: HTTP ${invalidLink.status}`,
  );

  // Dual-secret admin API: token-only linkding clients cannot import.
  const adminPath = "/api/admin/pinboard-import/";
  const noImportKey = await request("GET", adminPath + "?runId=" + "0".repeat(64));
  expectStatus(noImportKey, 404, "second import key required");
  const importHeaders = {
    Authorization: `Token ${token}`,
    "X-Flareding-Import-Key": importSecret,
  };
  const importRunId = createHash("sha256").update(randomUUID()).digest("hex");
  const preStats = await fetch(origin + adminPath + "?runId=" + importRunId, {
    headers: importHeaders,
  });
  assert.equal(preStats.status, 200);
  const initialStats = await preStats.json();
  assert.equal(initialStats.importedRecords, 0);

  const importUrls = [
    `https://example.net/flareding-import-${randomUUID()}`,
    `https://example.net/flareding-import-${randomUUID()}`,
  ];
  const records = importUrls.map((url, i) => ({
    url,
    title: "Synthetic Pinboard " + i,
    description: "No personal data",
    notes: "",
    createdAt: "2007-03-04T05:06:07.000Z",
    isUnread: i === 0,
    shared: i !== 0,
    tags: i === 0 ? ["import-tag", "replay"] : ["import-tag"],
    metadata: { source: "pinboard", hash: "synthetic" },
  }));
  const digest = createHash("sha256").update(stableJson(records)).digest("hex");
  const importBody = { runId: importRunId, batchIndex: 0, digest, records };
  async function adminImport(payload, accessHeaders = importHeaders) {
    const response = await fetch(origin + adminPath, {
      method: "POST",
      headers: { ...accessHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }
  expectStatus(
    await adminImport(importBody, { Authorization: `Token ${token}` }),
    404,
    "import requires extra key",
  );
  const firstBatch = await adminImport(importBody);
  expectStatus(firstBatch, 200, "atomic Pinboard import");
  assert.deepEqual(firstBatch.body, { replay: false, inserted: 2, skipped: 0, recordCount: 2 });
  const repeatedBatch = await adminImport(importBody);
  expectStatus(repeatedBatch, 200, "replay");
  assert.equal(repeatedBatch.body.replay, true);
  expectStatus(
    await adminImport({ ...importBody, digest: "0".repeat(64) }),
    400,
    "digest mismatch",
  );
  expectStatus(
    await adminImport({ ...importBody, digest: "1".repeat(64), records: [...records].reverse() }),
    400,
    "digest mismatch on changed payload",
  );
  const imported = await request("GET", "/api/bookmarks/?q=Synthetic%20Pinboard");
  expectStatus(imported, 200, "import read");
  assert.ok(imported.body.results.length >= 2);
  for (const record of imported.body.results.filter((r) => importUrls.includes(r.url))) {
    assert.equal(record.date_added, "2007-03-04T05:06:07.000Z");
  }
  const afterStatsResponse = await fetch(origin + adminPath + "?runId=" + importRunId, {
    headers: importHeaders,
  });
  assert.equal(afterStatsResponse.status, 200);
  const afterStats = await afterStatsResponse.json();
  assert.equal(afterStats.insertedRecords, 2);
  assert.equal(afterStats.importedRecords, 2);
  assert.equal(afterStats.completedBatches, 1);
  assert.equal(afterStats.totalBookmarks, initialStats.totalBookmarks + 2);
  for (const importedBookmark of imported.body.results.filter((r) => importUrls.includes(r.url))) {
    expectStatus(
      await request("DELETE", `/api/bookmarks/${importedBookmark.id}/`),
      204,
      "cleanup import test record",
    );
  }

  const url = `https://example.com/flareding-e2e-${randomUUID()}`;
  const created = await request("POST", "/api/bookmarks/", {
    url,
    title: "SQLite Durable Objects",
    tag_names: ["cloudflare", "drizzle", "cloudflare"],
    unread: true,
  });
  expectStatus(created, 201, "create");
  assert.equal(typeof created.body.id, "number");
  assert.deepEqual(created.body.tag_names, ["cloudflare", "drizzle"]);
  const id = created.body.id;
  const duplicate = await request("POST", "/api/bookmarks/", { url, title: "Same URL Updated" });
  expectStatus(duplicate, 201, "linkding duplicate upsert");
  assert.equal(duplicate.body.id, id);
  assert.equal(duplicate.body.title, "Same URL Updated");

  const read = await request("GET", `/api/bookmarks/${id}/`);
  expectStatus(read, 200, "read");
  assert.equal(read.body.url, url);
  expectStatus(
    await request("PATCH", `/api/bookmarks/${id}/`, { notes: "Patched", tag_names: ["sqlite"] }),
    200,
    "patch",
  );
  const exactTag = await request("GET", "/api/bookmarks/?tag=sqlite");
  expectStatus(exactTag, 200, "index-assisted tag filter");
  assert.ok(exactTag.body.results.some((bookmark) => bookmark.id === id));
  const missingTag = await request("GET", "/api/bookmarks/?tag=does-not-exist");
  expectStatus(missingTag, 200, "missing tag");
  assert.equal(missingTag.body.count, 0);
  const unreadOnly = await request("GET", "/api/bookmarks/?unread=true");
  expectStatus(unreadOnly, 200, "unread collection");
  assert.ok(unreadOnly.body.results.some((bookmark) => bookmark.id === id));
  const explicitFalse = await request("GET", "/api/bookmarks/?unread=false");
  expectStatus(explicitFalse, 200, "false unread must not filter");
  assert.ok(explicitFalse.body.results.some((bookmark) => bookmark.id === id));
  const list = await request("GET", "/api/bookmarks/?q=Updated&limit=1");
  expectStatus(list, 200, "list");
  assert.ok(list.body.results.some((bookmark) => bookmark.id === id));
  const tagList = await request("GET", "/api/tags/");
  expectStatus(tagList, 200, "tags list");
  assert.ok(tagList.body.results.some((tag) => tag.name === "sqlite"));

  expectStatus(await request("POST", `/api/bookmarks/${id}/archive/`), 200, "archive");
  const archived = await request("GET", "/api/bookmarks/archived/");
  expectStatus(archived, 200, "archived list");
  assert.ok(archived.body.results.some((bookmark) => bookmark.id === id));
  expectStatus(await request("POST", `/api/bookmarks/${id}/unarchive/`), 200, "unarchive");

  expectStatus(await request("DELETE", `/api/bookmarks/${id}/`), 204, "delete");
  const missing = await request("GET", `/api/bookmarks/${id}/`);
  expectStatus(missing, 404, "missing");
  assert.equal(missing.body.detail, "Not found.");
  const logout = await fetch(origin + "/api/session/", {
    method: "DELETE",
    headers: { Cookie: cookie, Origin: origin },
  });
  assert.equal(logout.status, 204);
  console.log(
    "Real workerd/SQLite DO: token + HttpOnly session, dual-secret atomic import/replay and preserved timestamps, CRUD/tags/search/archive/delete passed.",
  );
} catch (error) {
  // Dev logs may contain request metadata; do not emit tokens.
  console.error("Integration test failed:", error instanceof Error ? error.message : String(error));
  if (process.env.DEBUG_INTEGRATION === "true")
    console.error(logs.replaceAll(token, "[REDACTED]").slice(-6000));
  process.exitCode = 1;
} finally {
  stop();
}
