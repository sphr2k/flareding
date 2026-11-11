import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../drizzle/migrations/migrations.js", import.meta.url);
const original = readFileSync(path, "utf8");
// Drizzle Kit's generated JS imports .sql as an asset by default under Vite.
// Use raw imports so the migration runner receives SQL statements, not URLs.
const adapted =
  original
    .replace(/(from\s+['"][^'"]+\.sql)(['"])/g, "$1?raw$2")
    .replace(/[ \t]+$/gm, "")
    .trimEnd() + "\n";
if (!/\.sql\?raw/.test(adapted)) {
  throw new Error("No .sql imports found in Drizzle migrations");
}
if (adapted !== original) writeFileSync(path, adapted);
console.log("Drizzle SQL migrations loaded as raw strings for workerd.");
