/**
 * Stable JSON stringification for import integrity hashes.
 * Zod reorders object properties according to schema definitions; hashing
 * raw JSON.stringify(payload) would therefore reject otherwise identical
 * validated records. Array order is deliberately preserved.
 */
export function stableJson(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, v]) => [key, sort(v)]),
      );
    }
    return input;
  }
  return JSON.stringify(sort(value));
}
