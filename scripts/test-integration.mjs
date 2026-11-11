/** Real workerd integration tests through cf dev, not SQLite mocks.
 * Uses an ephemeral token and an isolated Worker port.
 */
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const devVars = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
const localToken = /^API_TOKEN=(.+)$/m.exec(devVars)?.[1];
const token = localToken ?? randomBytes(48).toString("base64url");
const port = Number(process.env.FLAREDING_TEST_PORT ?? 8797);
const origin = `http://127.0.0.1:${port}`;
const child = spawn("cf", ["dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
  cwd: process.cwd(),
  env: { ...process.env, API_TOKEN: token },
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});
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
    "Real workerd/SQLite DO: token + HttpOnly session auth/CSRF, CRUD/upsert, tags, search, archive, delete and 404 passed.",
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
