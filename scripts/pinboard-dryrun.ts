import { readFileSync } from "node:fs";
import { planPinboardImport } from "../src/import/pinboard.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: bun scripts/pinboard-dryrun.ts /path/to/private-pinboard-export.json");
  process.exit(2);
}
const data: unknown = JSON.parse(readFileSync(path, "utf8"));
const plan = planPinboardImport(data);
const schemes: Record<string, number> = {};
for (const row of plan.unsupported) {
  schemes[row.scheme] = (schemes[row.scheme] ?? 0) + 1;
}
// Aggregates only; never print private titles, URLs or actual tags.
console.log(JSON.stringify({ ...plan.stats, unsupportedSchemes: schemes }, null, 2));
if (plan.stats.invalid || plan.stats.duplicateUrls) process.exitCode = 1;
