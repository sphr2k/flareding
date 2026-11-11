import { stableJson } from "../src/import/digest.ts";
/**
 * Private, restartable Pinboard JSON import over dual-secret admin API.
 *
 * Does not persist the normalized dataset or print personal URLs, titles,
 * descriptions, hashes or tag values. Intentionally refuses non-staging hosts.
 *
 * Usage:
 *   bun run pinboard:import -- --source /workspace/pinboard/export.json --apply
 *   bun run pinboard:import -- --source /workspace/pinboard/export.json --verify-only
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { planPinboardImport } from "../src/import/pinboard.js";
import { importRecord } from "../src/import/batch-schema.js";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}
const source = arg("--source", undefined);
const secretsPath = arg("--secrets-file", ".secrets/staging.json");
const origin = arg("--url", "https://flareding-staging.janwer.workers.dev");
const apply = args.includes("--apply");
const verifyOnly = args.includes("--verify-only");
if (!source) throw new Error("Pass --source <private-pinboard-json>");
if (apply && verifyOnly) throw new Error("Select --apply or --verify-only");
const parsedOrigin = new URL(origin);
if (
  parsedOrigin.protocol !== "https:" ||
  !parsedOrigin.hostname.endsWith("-staging.janwer.workers.dev")
) {
  throw new Error("Refusing to import to a non-staging hostname");
}
const sourceBytes = readFileSync(source);
const plan = planPinboardImport(JSON.parse(sourceBytes.toString("utf8")));
const runId = createHash("sha256").update(sourceBytes).digest("hex");
const credentials = JSON.parse(readFileSync(secretsPath, "utf8"));
const apiToken = credentials.API_TOKEN;
const importSecret = credentials.IMPORT_SECRET;
if (
  typeof apiToken !== "string" ||
  apiToken.length < 32 ||
  typeof importSecret !== "string" ||
  importSecret.length < 32 ||
  apiToken === importSecret
) {
  throw new Error("Two distinct high-entropy API_TOKEN and IMPORT_SECRET credentials are required");
}
const headers = {
  Authorization: `Token ${apiToken}`,
  "X-Flareding-Import-Key": importSecret,
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const target = origin + "/api/admin/pinboard-import/";
const statsUrl = target + "?runId=" + runId;

function safeError(message) {
  // Never emit HTTP response bodies; they could contain private data if
  // a proxy or application bug reflects an import record.
  return new Error(message);
}
async function api(method, url, payload) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status >= 500 && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
        continue;
      }
      if (!response.ok) throw safeError(`HTTP ${response.status} from private import endpoint`);
      return await response.json();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("HTTP ")) throw error;
      if (attempt === 4) throw safeError("Private import endpoint could not be reached");
      await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
    }
  }
  throw safeError("No import response");
}
function countTarget(list) {
  return {
    totalBookmarks: list.entries.length,
    privateBookmarks: list.stats.private,
    unreadBookmarks: list.stats.unread,
    tagAssignments: list.stats.tagAssignments,
    importedRecords: list.entries.length,
  };
}
function checkAggregate(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value)
      throw new Error(
        `Import verification mismatch in ${key}: expected ${value}, got ${actual[key]}`,
      );
  }
}
const initial = await api("GET", statsUrl);
console.log(
  JSON.stringify({
    stage: "preflight",
    records: plan.stats.received,
    importable: plan.stats.importable,
    unsupported: plan.stats.unsupported,
    completedBatches: initial.completedBatches,
    currentBookmarks: initial.totalBookmarks,
    runFingerprint: runId.slice(0, 12),
  }),
);
if (!apply && !verifyOnly) {
  console.log("Dry-run only. Pass --apply to write imported bookmarks.");
  process.exit(0);
}
if (plan.stats.invalid || plan.stats.duplicateUrls)
  throw new Error("Rejecting malformed or duplicate source records");
if (!verifyOnly && initial.totalBookmarks !== initial.insertedRecords) {
  throw new Error(
    "Target contains records outside the selected import run; refusing to merge without review",
  );
}

const entries = plan.entries.map((entry, i) => {
  const value = {
    url: entry.url,
    title: entry.title,
    description: entry.description,
    notes: entry.notes,
    shared: entry.shared,
    isUnread: entry.unread,
    createdAt: entry.createdAt.toISOString(),
    tags: entry.tags,
    metadata: entry.metadata,
  };
  const parsed = importRecord.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid normalized Pinboard bookmark at index ${i}`);
  return parsed.data;
});
const batchSize = 50;
const expectedBatches = Math.ceil(entries.length / batchSize);
if (apply) {
  for (let batchIndex = 0; batchIndex < expectedBatches; batchIndex++) {
    const records = entries.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
    const digest = createHash("sha256").update(stableJson(records)).digest("hex");
    const result = await api("POST", target, {
      runId,
      batchIndex,
      digest,
      records,
    });
    if (result.recordCount !== records.length)
      throw new Error(`Unexpected committed record count in batch ${batchIndex}`);
    if ((batchIndex + 1) % 10 === 0 || batchIndex + 1 === expectedBatches) {
      console.log(
        JSON.stringify({
          stage: "progress",
          committedBatches: batchIndex + 1,
          totalBatches: expectedBatches,
          recordsProcessed: Math.min((batchIndex + 1) * batchSize, entries.length),
        }),
      );
    }
  }
}
const result = await api("GET", statsUrl);
checkAggregate(result, countTarget(plan));
if (result.completedBatches !== expectedBatches)
  throw new Error(
    `Incomplete checkpoint table: ${result.completedBatches} of ${expectedBatches} batches`,
  );
if (result.skippedRecords !== 0)
  throw new Error(`Import unexpectedly skipped ${result.skippedRecords} existing bookmark records`);
const firstDate = new Date(
  Math.min(...entries.map((row) => Date.parse(row.createdAt))),
).toISOString();
const lastDate = new Date(
  Math.max(...entries.map((row) => Date.parse(row.createdAt))),
).toISOString();
if (result.firstDate !== firstDate || result.lastDate !== lastDate)
  throw new Error("Original Pinboard bookmark timestamps are not preserved");

let final = { stats: result, orphanTagsRemoved: 0 };
if (apply) {
  final = await api("POST", origin + "/api/admin/pinboard-finalize/", {
    runId,
    expected: countTarget(plan),
  });
}
if (final.stats.tags !== plan.stats.distinctTags)
  throw new Error(
    `Tag cardinality mismatch: expected ${plan.stats.distinctTags}, got ${final.stats.tags}`,
  );

console.log(
  JSON.stringify({
    stage: "verified",
    bookmarks: final.stats.totalBookmarks,
    private: final.stats.privateBookmarks,
    unread: final.stats.unreadBookmarks,
    tags: final.stats.tags,
    tagAssignments: final.stats.tagAssignments,
    imported: final.stats.importedRecords,
    skipped: final.stats.skippedRecords,
    completedBatches: final.stats.completedBatches,
    orphanTagsRemoved: final.orphanTagsRemoved,
    timestampRangeVerified: true,
  }),
);
