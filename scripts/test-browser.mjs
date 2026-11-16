/**
 * Optional real-Chromium Spectrum 2 smoke test.
 * Requires: bunx playwright install chromium
 *
 * Starts isolated local cf dev with an ephemeral account token, creates only
 * synthetic bookmarks, exercises CardView and pagination, and deletes them.
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
const newTag = `browser-new-tag-${randomUUID()}`;
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
          ? "Synthetic very long title to check layout, wrapping and responsiveness – Unicode äöü 漢字"
          : `Synthetic bookmark ${i + 1}`,
      description:
        i === 0
          ? ""
          : "Test document for Spectrum CardView and list navigation.".repeat(i === 6 ? 5 : 1),
      tag_names:
        i === 6
          ? ["one", "two", "three", "four", "five"]
          : i % 2
            ? ["typescript", "docs"]
            : ["cloudflare", "sqlite"],
      unread: i % 2 === 0,
    });
    if (response.status !== 201) throw new Error(`Synthetic seed failed: HTTP ${response.status}`);
    created.push((await response.json()).id);
  }

  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Cloudflare local Vite startup can finish health checks before the first HTML bundle.
  page.setDefaultNavigationTimeout(60_000);
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
  await page.getByLabel("API token").fill(token);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.locator('[role="gridcell"]').first().waitFor();
  await page.getByText("Synthetic bookmark 1").first().waitFor();
  // Unified search: asynchronous tag: suggestions, keyboard selection,
  // multi-tag AND, free-text and round-tripping bookmarked URL state.
  const globalSearch = page.getByRole("combobox", { name: "Search bookmarks" });
  // Native highlighting must win over the raw typed fragment ("d").
  // This also covers Enter bubbling from the Spectrum ComboBox into the
  // surrounding unified-search surface.
  await globalSearch.fill("tag:d");
  await page.getByRole("option", { name: "docs", exact: true }).waitFor();
  await globalSearch.press("ArrowDown");
  const focusedOption = await globalSearch.evaluate((input) => {
    const id = input.getAttribute("aria-activedescendant");
    return id ? document.getElementById(id)?.textContent?.trim() : null;
  });
  if (focusedOption !== "cloudflare")
    throw new Error("Native option highlight unexpected: " + focusedOption);
  await globalSearch.press("Enter");
  await page.waitForFunction(() => new URL(location.href).searchParams.getAll("tag").length === 1);
  if (!new URL(page.url()).searchParams.getAll("tag").includes("cloudflare"))
    throw new Error("Enter did not select the highlighted Spectrum suggestion");
  await globalSearch.fill("");
  await globalSearch.press("Backspace");
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("tag"));

  await globalSearch.fill("tag:docs");
  await page.getByRole("option", { name: "docs", exact: true }).waitFor();
  await globalSearch.press("ArrowDown");
  await globalSearch.press("Enter");
  await page.waitForFunction(() =>
    new URL(location.href).searchParams.getAll("tag").includes("docs"),
  );
  await globalSearch.fill("tag:typescript");
  await page.getByRole("option", { name: "typescript", exact: true }).waitFor();
  await globalSearch.press("ArrowDown");
  await globalSearch.press("Enter");
  await page.waitForFunction(() => new URL(location.href).searchParams.getAll("tag").length === 2);
  // Selection should close the native menu; a stale "No results" popup must
  // never cover active chips or the compact mobile header.
  await page.getByRole("listbox").waitFor({ state: "hidden" });

  // Inspect both native controls while tag chips are present, not only after
  // the end-to-end test removes the selected filters.
  await page.screenshot({ path: ".cloudflare/unified-search-tags-desktop.png" });
  await page.setViewportSize({ width: 360, height: 900 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: ".cloudflare/unified-search-tags-mobile.png" });
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
    throw new Error("Unified search chips overflow mobile viewport");
  await page.setViewportSize({ width: 1440, height: 900 });

  await globalSearch.fill("Synthetic");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "Synthetic");
  await page.locator('[role="gridcell"]').first().waitFor();
  await page.reload();
  await page.locator('[role="gridcell"]').first().waitFor();
  if ((await page.getByRole("combobox", { name: "Search bookmarks" }).inputValue()) !== "Synthetic")
    throw Error("Unified search text was not restored from URL");
  if (new URL(page.url()).searchParams.getAll("tag").length !== 2)
    throw Error("Multi-tag chip filters were not restored from URL");
  await globalSearch.fill("");
  await globalSearch.press("Backspace");
  await page.waitForFunction(() => new URL(location.href).searchParams.getAll("tag").length === 1);
  await globalSearch.press("Backspace");
  await page.waitForFunction(() => new URL(location.href).searchParams.getAll("tag").length === 0);
  await page.goto(origin);
  await page.getByText("Synthetic bookmark 1").first().waitFor();
  if (await page.getByRole("button", { name: "Tag filter", exact: true }).count())
    throw Error("Obsolete Tag filter must not be present");

  await page.getByRole("radio", { name: "Unread", exact: true }).click();
  await page
    .getByRole("radio", { name: "Unread", exact: true })
    .getAttribute("aria-checked")
    .then((selected) => {
      if (selected !== "true") throw Error("Unread tab did not activate");
    });
  await page.getByRole("radio", { name: "All", exact: true }).click();

  await page.getByRole("heading", { name: "Bookmarks", exact: true }).waitFor();
  const rail = page.getByRole("navigation", { name: "Bookmark collections" });
  if (!(await rail.getByRole("button", { name: "Add bookmark", exact: true }).isVisible()))
    throw new Error("Add must be in the left navigation");
  const alignment = await page.evaluate(() => {
    const heading = document.querySelector("main h1").getBoundingClientRect();
    const cards = [...document.querySelectorAll('[role="row"]')]
      .map((n) => n.getBoundingClientRect())
      .filter((r) => r.width > 0);
    return Math.abs(heading.x - Math.min(...cards.map((r) => r.x)));
  });
  if (alignment > 4)
    throw new Error(`Cards are not aligned with the content heading: ${alignment}px`);

  await page.mouse.move(2, 2);
  await rail.getByRole("radio", { name: "All", exact: true }).hover();
  await page.getByRole("tooltip", { name: "All bookmarks" }).waitFor();
  await page.mouse.move(2, 2);
  await page.getByRole("tooltip", { name: "All bookmarks" }).waitFor({ state: "hidden" });
  const longTitle = page.getByText(
    "Synthetic very long title to check layout, wrapping and responsiveness – Unicode äöü 漢字",
    { exact: true },
  );
  if ((await longTitle.evaluate((node) => getComputedStyle(node).webkitLineClamp)) !== "3")
    throw new Error("Bookmark title must be limited to three lines");

  // The trigger must share the native Card content grid with its title and be
  // aligned with the icon, not displaced above the bookmark header.
  const menu = page.getByRole("button", { name: "Actions for Synthetic bookmark 1" });
  const geometry = await menu.evaluate((button) => {
    const content = button.parentElement;
    const icon = content.querySelector('[role="img"]');
    const buttonRect = button.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    return {
      display: getComputedStyle(content).display,
      centerDifference: Math.abs(
        buttonRect.top + buttonRect.height / 2 - (iconRect.top + iconRect.height / 2),
      ),
    };
  });
  if (geometry.display !== "grid" || geometry.centerDifference > 4)
    throw new Error(`Card menu is not aligned with its header: ${JSON.stringify(geometry)}`);
  let popupCount = 0;
  page.on("popup", () => popupCount++);
  await menu.click();
  await page.getByRole("menuitem", { name: "Archive" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("menuitem", { name: "Archive" }).waitFor({ state: "hidden" });
  const focusReturned = await page.evaluate(() => {
    const active = document.activeElement;
    return (
      active?.getAttribute("role") === "row" &&
      active.getAttribute("aria-label") === "Synthetic bookmark 1"
    );
  });
  if (!focusReturned) throw new Error("Focus did not return to the bookmark after Escape");
  await page.keyboard.press("Tab");
  if (!(await menu.evaluate((button) => button === document.activeElement)))
    throw new Error("Card menu is not reachable by keyboard");
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Archive" }).waitFor();
  await page.keyboard.press("Escape");
  if (popupCount) throw new Error("Opening the card menu followed the bookmark link");

  await menu.click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit bookmark" }).waitFor();
  const titleInput = page.getByLabel("Title", { exact: true });
  if (!(await titleInput.evaluate((node) => node === document.activeElement)))
    throw new Error("Edit must focus title");
  if (await page.getByRole("button", { name: "Save", exact: true }).isEnabled())
    throw new Error("Unchanged edit must not save");
  await titleInput.fill("Synthetic bookmark edited");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("alertdialog", { name: "Discard changes?" }).waitFor();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  if ((await titleInput.inputValue()) !== "Synthetic bookmark edited")
    throw new Error("Continuing edit lost changes");
  // Server-provided active tags must appear after asynchronous search.
  const addTag = page.getByRole("combobox", { name: "Add tag" });
  await addTag.fill("docs");
  await page.getByRole("option", { name: "docs", exact: true }).waitFor();
  await page.getByRole("option", { name: "docs", exact: true }).click();
  await addTag.fill(newTag);
  await page.getByRole("option", { name: `Add “${newTag}”` }).waitFor();
  const tagFieldBox = await page.getByRole("combobox", { name: "Add tag" }).boundingBox();
  const suggestionsBox = await page.getByRole("listbox").boundingBox();
  if (!tagFieldBox || !suggestionsBox || suggestionsBox.y < tagFieldBox.y + tagFieldBox.height)
    throw new Error("Tag suggestions must stay below the input");
  await page.getByRole("option", { name: `Add “${newTag}”` }).click();
  await page.getByLabel("Description", { exact: true }).fill("Edited synthetic description");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog", { name: "Edit bookmark" }).waitFor({ state: "hidden" });
  await page.getByText("Synthetic bookmark edited", { exact: true }).waitFor();
  const saved = await api("GET", `/api/bookmarks/${created[0]}/`);
  const edited = await saved.json();
  if (
    edited.title !== "Synthetic bookmark edited" ||
    edited.description !== "Edited synthetic description" ||
    !edited.tag_names.includes(newTag)
  )
    throw new Error("Edited bookmark was not persisted");

  // Truncated tag summaries disclose every tag on hover and keyboard focus.
  const tagSummary = page.getByRole("button", { name: "Show all 5 bookmark tags" });
  await tagSummary.hover();
  await page.getByText("five", { exact: true }).waitFor();
  await page.mouse.move(2, 2);
  await page.getByText("five", { exact: true }).waitFor({ state: "hidden" });
  await tagSummary.focus();
  await page.getByText("five", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByText("five", { exact: true }).waitFor({ state: "hidden" });

  const cardCount = await page.locator('[role="gridcell"]').count();
  if (cardCount < 8) throw new Error(`Expected at least 8 CardView items, found ${cardCount}`);
  const cardHeights = await page
    .locator('[role="gridcell"]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => Math.round(node.getBoundingClientRect().height))
        .filter((height) => height > 0),
    );
  if (cardHeights.length && Math.max(...cardHeights) > 350) {
    throw new Error("Bookmark CardView cards are too tall: " + Math.max(...cardHeights) + "px");
  }

  // The list view and its toggle are removed: there is only one CardView.
  if (await page.getByRole("radio", { name: "List", exact: true }).count())
    throw new Error("Removed List view toggle is still present");
  if (!(await page.getByRole("grid", { name: "Bookmark cards" }).count()))
    throw new Error("Cards must remain the only bookmark display");

  // Verify keyboard navigation and the native Spectrum dialog.
  // Delete uses the pre-existing Linkding DELETE API, but only after a
  // destructive Spectrum AlertDialog confirmation.
  const deleteCandidate = page.getByRole("button", { name: "Actions for Synthetic bookmark 2" });
  await deleteCandidate.click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete bookmark?" });
  await deleteDialog.waitFor();
  await deleteDialog.getByRole("button", { name: "Cancel" }).click();
  const retained = await api("GET", `/api/bookmarks/${created[1]}/`);
  if (retained.status !== 200) throw new Error("Delete Cancel must retain bookmark");
  await deleteCandidate.click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await deleteDialog.waitFor();
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("Synthetic bookmark 2", { exact: true }).waitFor({ state: "hidden" });
  const erased = await api("GET", `/api/bookmarks/${created[1]}/`);
  if (erased.status !== 404) throw new Error("Confirmed Delete did not remove bookmark");

  await page.locator("body").click({ position: { x: 6, y: 6 } });
  await page.keyboard.press("/");
  const searchFocused = await page.evaluate(() => {
    const node = document.activeElement;
    return node?.tagName === "INPUT" && node.getAttribute("role") === "combobox";
  });
  if (!searchFocused) throw new Error("Slash key did not focus unified Spectrum ComboBox");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 6, y: 6 } });
  await page.keyboard.press("n");
  await page.getByRole("dialog", { name: "Add bookmark" }).waitFor();
  if (
    !(await page
      .getByLabel("URL", { exact: true })
      .evaluate((node) => node === document.activeElement))
  )
    throw new Error("Create must focus URL");
  await page.getByLabel("Description", { exact: true }).waitFor();
  await page.getByLabel("Notes", { exact: true }).waitFor();
  for (const width of [360, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `.cloudflare/bookmark-dialog-${width}.png` });
    const box = await page.getByRole("dialog", { name: "Add bookmark" }).boundingBox();
    if (!box || box.width > width) throw new Error(`Dialog overflows at ${width}px`);
  }
  await page.getByRole("button", { name: "Cancel" }).click();

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

  // Isolated Access-mode UI test with fake session and synthetic token. No real
  // personal data or credentials are requested, saved or captured in screenshots.
  const settingsContext = await browser.newContext({
    viewport: { width: 720, height: 720 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const settingsPage = await settingsContext.newPage();
  const fakeToken = "synthetic-test-token-do-not-use";
  await settingsPage.route("**/api/session/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true, login: "access" }),
    }),
  );
  await settingsPage.route("**/api/bookmarks/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    }),
  );
  await settingsPage.route("**/api/tags/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0, next: null, previous: null, results: [] }),
    }),
  );
  await settingsPage.route("**/auth/access/token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: fakeToken }),
    }),
  );
  await settingsPage.goto(origin);
  await settingsPage.getByRole("button", { name: "Account" }).click();
  await settingsPage.getByRole("menuitem", { name: "Settings" }).click();
  const settingsDialog = settingsPage.getByRole("dialog", { name: "Settings" });
  // Spectrum animates the initial dialog transform; compare settled geometry only.
  await settingsPage.waitForTimeout(500);
  const tokenField = settingsPage.getByRole("textbox", { name: "API token", exact: true });
  if ((await tokenField.inputValue()) === fakeToken)
    throw new Error("Token revealed without explicit interaction");
  const initialDialog = await settingsDialog.boundingBox();
  const initialField = await tokenField.boundingBox();
  const initialButton = await settingsPage
    .getByRole("button", { name: "Reveal and copy API token" })
    .boundingBox();
  await tokenField.click();
  await settingsPage.getByRole("button", { name: "Copy API token" }).waitFor();
  await settingsPage.getByText("Token copied to clipboard.").waitFor();
  if ((await settingsPage.evaluate(() => navigator.clipboard.readText())) !== fakeToken)
    throw new Error("First reveal did not copy synthetic API token");
  if ((await tokenField.inputValue()) !== fakeToken) throw new Error("Click did not reveal token");
  const shownDialog = await settingsDialog.boundingBox();
  const shownField = await tokenField.boundingBox();
  const shownButton = await settingsPage
    .getByRole("button", { name: "Copy API token" })
    .boundingBox();
  if (
    !initialDialog ||
    !initialField ||
    !initialButton ||
    !shownDialog ||
    !shownField ||
    !shownButton ||
    Math.abs(initialDialog.height - shownDialog.height) > 2 ||
    Math.abs(initialField.width - shownField.width) > 2 ||
    Math.abs(initialField.y - shownField.y) > 2 ||
    Math.abs(initialButton.width - shownButton.width) > 2
  )
    throw new Error(
      "Settings dialog layout changed after token reveal: " +
        JSON.stringify({
          initialDialog,
          shownDialog,
          initialField,
          shownField,
          initialButton,
          shownButton,
        }),
    );
  await settingsPage.getByRole("button", { name: "Copy API token" }).click();
  const copied = await settingsPage.evaluate(() => navigator.clipboard.readText());
  if (copied !== fakeToken) throw new Error("Copy button did not copy synthetic token");
  for (const width of [360, 720]) {
    await settingsPage.setViewportSize({ width, height: 720 });
    const bounds = await settingsDialog.boundingBox();
    if (!bounds || bounds.width > width)
      throw new Error("Settings dialog overflows narrow viewport");
  }
  await settingsContext.close();

  const iconCount = await page.locator('img[src*="/api/site-icons/"]').count();
  if (!iconCount)
    throw new Error("Visible bookmarks did not render lazy same-origin favicon images");
  if (!iconRequests.has("example.org"))
    throw new Error("The browser did not lazily request a visible site icon");

  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.length}`);

  console.log(
    `Spectrum browser smoke succeeded: ${cardCount} grid items, Delete confirmed, no JS errors.`,
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
