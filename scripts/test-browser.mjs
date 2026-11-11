/**
 * Optional real-Chromium Spectrum 2 smoke test.
 * Requires: bunx playwright install chromium
 *
 * Starts isolated local cf dev with an ephemeral account token, creates only
 * synthetic bookmarks, exercises Grid/List and pagination, and deletes them.
 */
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const devVars = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
const token = /^API_TOKEN=(.+)$/m.exec(devVars)?.[1];
if (!token) throw new Error("Configure a Git-ignored .dev.vars with a local-only API_TOKEN");
const port = Number(process.env.FLAREDING_BROWSER_PORT ?? 8799);
const origin = `http://127.0.0.1:${port}`;
const child = spawn("cf", ["dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
  env: process.env,
  cwd: process.cwd(),
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
let serverLogs = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serverLogs = (serverLogs + chunk).slice(-4000);
  });
}
const created = [];
function stop() {
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    // Already exited.
  }
}
async function api(method, path, data) {
  return fetch(origin + path, {
    method,
    headers: {
      Authorization: `Token ${token}`,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
try {
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error("Cloudflare dev exited before ready");
    try {
      const r = await fetch(origin + "/api/health");
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* Startup */
    }
    await delay(300);
  }
  if (!ready) throw new Error("Local Worker did not become healthy");

  // Use synthetic URLs and subjects exclusively, never the private export.
  for (let i = 0; i < 8; i++) {
    const response = await api("POST", "/api/bookmarks/", {
      url: `https://example.org/flareding-browser-test-${randomUUID()}`,
      title: `Synthetic bookmark ${i + 1}`,
      description: "Test document for Spectrum CardView and list navigation.",
      tag_names: i % 2 ? ["typescript", "docs"] : ["cloudflare", "sqlite"],
    });
    if (response.status !== 201) throw new Error(`Synthetic seed failed: HTTP ${response.status}`);
    created.push((await response.json()).id);
  }

  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByLabel("API-Token").fill(token);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByRole("button", { name: "Listenansicht" }).waitFor();
  await page.getByText("Synthetic bookmark 1").first().waitFor();

  const cardCount = await page.locator('[role="gridcell"]').count();
  if (cardCount < 8) throw new Error(`Expected at least 8 CardView items, found ${cardCount}`);

  await page.getByRole("button", { name: "Listenansicht" }).click();
  await page.getByRole("button", { name: "Kachelansicht" }).waitFor();
  const listCount = await page.locator("article").count();
  if (listCount < 8) throw new Error(`Expected at least 8 list items, found ${listCount}`);
  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.length}`);

  console.log(
    `Spectrum browser smoke succeeded: ${cardCount} grid items, ${listCount} list items, no JS errors.`,
  );
} catch (error) {
  // Never include the token, cookies, or private export values in CI output.
  console.error(
    error instanceof Error ? error.message.replaceAll(token, "[REDACTED]") : "Browser smoke failed",
  );
  if (process.env.DEBUG_BROWSER === "true")
    console.error(serverLogs.replaceAll(token, "[REDACTED]"));
  process.exitCode = 1;
} finally {
  for (const id of created) {
    await api("DELETE", `/api/bookmarks/${id}/`).catch(() => {});
  }
  await browser?.close();
  stop();
}
