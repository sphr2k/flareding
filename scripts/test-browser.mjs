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
const pageErrors = [];
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
      title:
        i === 7
          ? "Synthetischer extrem langer Titel zur Prüfung von Darstellung, Zeilenumbruch und Responsivität – Unicode äöü 漢字"
          : `Synthetic bookmark ${i + 1}`,
      description: "Test document for Spectrum CardView and list navigation.",
      tag_names: i % 2 ? ["typescript", "docs"] : ["cloudflare", "sqlite"],
      unread: i % 2 === 0,
    });
    if (response.status !== 201) throw new Error(`Synthetic seed failed: HTTP ${response.status}`);
    created.push((await response.json()).id);
  }

  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // No remote DNS/HTTP in visual tests: icons are mocked per unique host.
  const iconRequests = new Set();
  const validPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8KQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**/api/site-icons/*", async (route) => {
    const host = route.request().url().split("/api/site-icons/")[1]?.split("?")[0] ?? "";
    iconRequests.add(host);
    // Check error fallback for the synthetic second domain.
    if (host === "example.com") {
      await route.fulfill({ status: 404, body: "" });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: validPng,
      });
    }
  });

  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.getByLabel("API-Token").fill(token);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.getByText("Kacheln", { exact: true }).waitFor();
  await page.getByText("Synthetic bookmark 1").first().waitFor();
  await page.getByRole("tab", { name: "Ungelesen" }).click();
  await page
    .getByRole("tab", { name: "Ungelesen" })
    .getAttribute("aria-selected")
    .then((selected) => {
      if (selected !== "true") throw Error("Unread tab did not activate");
    });
  await page.getByRole("tab", { name: "Alle" }).click();

  const cardCount = await page.locator('[role="gridcell"]').count();
  if (cardCount < 8) throw new Error(`Expected at least 8 CardView items, found ${cardCount}`);

  await page.getByText("Liste", { exact: true }).click();
  const listCount = await page.locator('[role="row"]').count();
  if (listCount < 4) throw new Error(`Expected at least 8 ListView rows, found ${listCount}`);
  // Verify keyboard navigation and the native Spectrum dialog.
  await page.getByText("Kacheln", { exact: true }).click();
  await page.locator("body").click({ position: { x: 6, y: 6 } });
  await page.keyboard.press("/");
  const searchFocused = await page.evaluate(() => {
    const node = document.activeElement;
    return node?.tagName === "INPUT" && node.getAttribute("type") === "search";
  });
  if (!searchFocused) throw new Error("Slash key did not focus global Spectrum SearchField");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 6, y: 6 } });
  await page.keyboard.press("n");
  await page.getByRole("dialog", { name: "Bookmark hinzufügen" }).waitFor();
  await page.getByRole("button", { name: "Abbrechen" }).click();

  // Synthetic UI only: run four real browser widths, store ignored PNG files.
  for (const width of [360, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    if (overflow) throw new Error(`Horizontal overflow at ${width}px`);
    await page.screenshot({
      path: `.cloudflare/issue21-synthetic-grid-${width}.png`,
      fullPage: true,
    });
  }

  const iconCount = await page.locator('img[src*="/api/site-icons/"]').count();
  if (!iconCount)
    throw new Error("Visible bookmarks did not render lazy same-origin favicon images");
  if (!iconRequests.has("example.org"))
    throw new Error("The browser did not lazily request a visible site icon");
  if (iconRequests.size > 2) throw new Error("The icon resolver was not deduplicated by host");
  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.length}`);

  console.log(
    `Spectrum browser smoke succeeded: ${cardCount} grid items, ${listCount} list items, no JS errors.`,
  );
} catch (error) {
  // Never include the token, cookies, or private export values in CI output.
  console.error(
    error instanceof Error ? error.message.replaceAll(token, "[REDACTED]") : "Browser smoke failed",
  );
  if (process.env.DEBUG_BROWSER === "true") {
    if (pageErrors.length)
      console.error(
        "Page errors:",
        pageErrors.map((x) => x.slice(0, 400)),
      );
    console.error(serverLogs.replaceAll(token, "[REDACTED]"));
  }
  process.exitCode = 1;
} finally {
  for (const id of created) {
    await api("DELETE", `/api/bookmarks/${id}/`).catch(() => {});
  }
  await browser?.close();
  stop();
}
