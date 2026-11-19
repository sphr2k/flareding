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

  const profilePath = "/api/user/profile/";
  expectStatus(await request("GET", profilePath, undefined, false), 401, "anonymous profile");
  const profile = await request("GET", profilePath);
  expectStatus(profile, 200, "Token-authenticated profile");
  assert.deepEqual(profile.body, {
    theme: "auto",
    bookmark_date_display: "relative",
    bookmark_link_target: "_blank",
    web_archive_integration: "disabled",
    tag_search: "strict",
    enable_sharing: false,
    enable_public_sharing: false,
    enable_favicons: true,
    display_url: false,
    permanent_notes: false,
    search_preferences: {},
    version: "0.0.0",
  });

  // MCP is protected by a separate verified Access application JWT, never the
  // linkding API token or a caller-controlled CF-Access-Client-ID header.
  const mcpRequest = (headers = {}) =>
    fetch(origin + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
  assert.equal((await mcpRequest()).status, 401, "MCP must deny anonymous requests");
  assert.equal(
    (await mcpRequest({ Authorization: `Token ${token}` })).status,
    401,
    "Linkding token must not grant MCP access",
  );
  assert.equal(
    (await mcpRequest({ "CF-Access-Jwt-Assertion": "forged" })).status,
    401,
    "Forged Access JWT must not grant MCP access",
  );

  expectStatus(await request("GET", "/api/bookmarks/", undefined, false), 401, "anonymous read");
  expectStatus(
    await request("GET", "/api/site-icons/localhost", undefined, false),
    401,
    "anonymous SSRF probing must require API authentication",
  );
  expectStatus(
    await request("GET", "/api/site-icons/127.0.0.1"),
    404,
    "private IP favicon target rejected without outbound fetch",
  );
  expectStatus(
    await request("GET", "/api/site-icons/metadata.google.internal"),
    404,
    "metadata domain favicon target rejected",
  );

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
  assert.equal(created.body.favicon_url, origin + "/api/site-icons/example.com");

  assert.deepEqual(created.body.tag_names, ["cloudflare", "drizzle"]);
  const id = created.body.id;
  const duplicate = await request("POST", "/api/bookmarks/", { url, title: "Same URL Updated" });
  expectStatus(duplicate, 201, "linkding duplicate upsert");
  assert.equal(duplicate.body.id, id);
  assert.equal(duplicate.body.title, "Same URL Updated");

  // PATCH/PUT collisions must report HTTP 409 and leave both records untouched.
  const otherUrl = `https://example.com/flareding-other-${randomUUID()}`;
  const other = await request("POST", "/api/bookmarks/", {
    url: otherUrl,
    title: "Existing destination",
  });
  expectStatus(other, 201, "create duplicate target");
  for (const method of ["PATCH", "PUT"]) {
    const conflict = await request(method, `/api/bookmarks/${id}/`, {
      url: otherUrl,
      title: "Must not be saved",
      tag_names: ["must-not-be-saved"],
    });
    expectStatus(conflict, 409, `${method} duplicate URL conflict`);
    assert.equal(conflict.body.detail, "A bookmark with this URL already exists.");
  }
  const read = await request("GET", `/api/bookmarks/${id}/`);
  expectStatus(read, 200, "read");
  assert.equal(read.body.title, "Same URL Updated");
  assert.deepEqual(read.body.tag_names, ["cloudflare", "drizzle"]);
  const otherUnchanged = await request("GET", `/api/bookmarks/${other.body.id}/`);
  expectStatus(otherUnchanged, 200, "duplicate target unchanged");
  assert.equal(otherUnchanged.body.title, "Existing destination");
  expectStatus(
    await request("PATCH", `/api/bookmarks/${id}/`, { url }),
    200,
    "patch with unchanged URL",
  );
  expectStatus(
    await request("DELETE", `/api/bookmarks/${other.body.id}/`),
    204,
    "remove duplicate target",
  );
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
  // LinkThing's default Unread view sends the legacy linkding query keyword.
  const linkthingUnread = await request("GET", "/api/bookmarks/?q=%21unread&limit=10&offset=0");
  expectStatus(linkthingUnread, 200, "LinkThing unread query");
  assert.equal(linkthingUnread.body.count, unreadOnly.body.count);
  assert.ok(linkthingUnread.body.results.some((bookmark) => bookmark.id === id));
  const linkthingSearch = await request("GET", "/api/bookmarks/?q=%21unread%20Updated");
  assert.ok(linkthingSearch.body.results.some((bookmark) => bookmark.id === id));
  const explicitFalse = await request("GET", "/api/bookmarks/?unread=false");
  expectStatus(explicitFalse, 200, "false unread must not filter");
  assert.ok(explicitFalse.body.results.some((bookmark) => bookmark.id === id));
  const list = await request("GET", "/api/bookmarks/?q=Updated&limit=1");
  expectStatus(list, 200, "list");
  assert.ok(list.body.results.some((bookmark) => bookmark.id === id));
  const tagList = await request("GET", "/api/tags/");
  expectStatus(tagList, 200, "tags list");
  assert.ok(tagList.body.results.some((tag) => tag.name === "sqlite"));

  const linkthingTags = await request("GET", "/api/tags/?limit=1000");
  expectStatus(linkthingTags, 200, "LinkThing tag page size");
  assert.ok(linkthingTags.body.results.some((tag) => tag.name === "sqlite"));
  for (const endpoint of ["tags", "bookmarks"]) {
    const million = await request("GET", `/api/${endpoint}/?limit=1000000`);
    expectStatus(million, 200, `upstream uncapped ${endpoint} page`);
    assert.equal(million.body.results.length, million.body.count);
    for (const limit of ["0", "-1", "invalid", "1.5"])
      expectStatus(
        await request("GET", `/api/${endpoint}/?limit=${limit}&offset=-1`),
        200,
        "upstream pagination fallback",
      );
  }
  // The additive Flareding v1 API filters by active usage; upstream Linkding
  // tag listing remains unchanged even when a tag belongs only to archived data.
  const archiveOnlyName = `archive-only-${randomUUID()}`;
  const sharedTagName = `shared-${randomUUID()}`;
  const activeTagName = `active-${randomUUID()}`;
  const spacedTagName = `synthetic tag with spaces ${randomUUID()}`;
  const activeUrl = `https://example.com/flareding-tag-active-${randomUUID()}`;
  const archiveUrl = `https://example.com/flareding-tag-archived-${randomUUID()}`;
  const activeForTags = await request("POST", "/api/bookmarks/", {
    url: activeUrl,
    title: "Synthetic active",
    tag_names: [sharedTagName, activeTagName, spacedTagName],
  });
  expectStatus(activeForTags, 201, "active synthetic bookmark for tags");
  const archivedForTags = await request("POST", "/api/bookmarks/", {
    url: archiveUrl,
    title: "Synthetic archived",
    tag_names: [archiveOnlyName, sharedTagName],
    is_archived: true,
  });
  expectStatus(archivedForTags, 201, "archived synthetic bookmark for tags");
  const upstreamAll = await request("GET", `/api/tags/?q=${archiveOnlyName}`);
  expectStatus(upstreamAll, 200, "upstream Linkding tags unchanged");
  assert.equal(upstreamAll.body.count, 1);
  assert.equal(upstreamAll.body.results[0].name, archiveOnlyName);
  const overlayArchivedHidden = await request(
    "GET",
    `/api/flareding/v1/tags/?q=${archiveOnlyName}`,
  );
  expectStatus(overlayArchivedHidden, 200, "Flareding overlay active-only default");
  assert.equal(overlayArchivedHidden.body.count, 0);
  const overlayArchivedIncluded = await request(
    "GET",
    `/api/flareding/v1/tags/?q=${archiveOnlyName}&include_archived=true`,
  );
  expectStatus(overlayArchivedIncluded, 200, "Flareding overlay include archived");
  assert.equal(overlayArchivedIncluded.body.count, 1);
  const overlayShared = await request("GET", `/api/flareding/v1/tags/?q=${sharedTagName}`);
  expectStatus(overlayShared, 200, "shared tag from active bookmark remains visible");
  assert.equal(overlayShared.body.count, 1);
  const bookmarkSearchPath = "/api/flareding/v1/bookmarks/search/";
  const matchedAnd = await request("POST", bookmarkSearchPath, {
    query: "Synthetic",
    tags: [sharedTagName, activeTagName],
    view: "all",
  });
  expectStatus(matchedAnd, 200, "additive AND filter");
  assert.equal(matchedAnd.body.count, 1);
  assert.equal(matchedAnd.body.results[0].id, activeForTags.body.id);
  const matchSpace = await request("POST", bookmarkSearchPath, {
    query: "Synthetic",
    tags: [spacedTagName, activeTagName],
    view: "all",
  });
  expectStatus(matchSpace, 200, "additive tags with spaces");
  assert.equal(matchSpace.body.count, 1);
  const notMatched = await request("POST", bookmarkSearchPath, {
    query: "Synthetic",
    tags: [activeTagName, archiveOnlyName],
    view: "all",
  });
  expectStatus(notMatched, 200, "AND tags must not act as OR");
  assert.equal(notMatched.body.count, 0);
  const archivedMatched = await request("POST", bookmarkSearchPath, {
    query: "Synthetic",
    tags: [sharedTagName, archiveOnlyName],
    view: "archived",
  });
  expectStatus(archivedMatched, 200, "overlay archived multi-tag search");
  assert.equal(archivedMatched.body.count, 1);
  const invalidSearch = await request("POST", bookmarkSearchPath, {
    query: "Synthetic",
    tags: Array(14).fill("invalid"),
  });
  assert.ok([400, 422].includes(invalidSearch.status), "tag filter limit validated");
  expectStatus(
    await request("POST", bookmarkSearchPath, { query: "Synthetic" }, false),
    401,
    "versioned search cannot be read anonymously",
  );

  const overlayBad = await request("GET", "/api/flareding/v1/tags/?include_archived=all");
  assert.ok([400, 422].includes(overlayBad.status));
  expectStatus(
    await request("DELETE", `/api/bookmarks/${activeForTags.body.id}/`),
    204,
    "cleanup synthetic active tag bookmark",
  );
  expectStatus(
    await request("DELETE", `/api/bookmarks/${archivedForTags.body.id}/`),
    204,
    "cleanup synthetic archived tag bookmark",
  );

  const filteredTags = await request("GET", "/api/tags/?q=SQLITE&limit=1");
  expectStatus(filteredTags, 200, "filtered tags");
  assert.equal(filteredTags.body.count, 1);
  assert.equal(filteredTags.body.results[0].name, "sqlite");
  const literalTags = await request("GET", "/api/tags/?q=%25_no_matching_tag");
  assert.equal(literalTags.body.count, 0);

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
