import { describe, expect, it } from "vite-plus/test";
import { stableJson } from "../src/import/digest.js";
import { importBatchInput } from "../src/import/batch-schema.js";

describe("deterministic Pinboard batch digests", () => {
  it("survives Zod field reordering across Worker and import client", () => {
    const original = [
      {
        url: "https://example.org/1",
        title: "Synthetic",
        description: "",
        notes: "",
        shared: false,
        isUnread: true,
        createdAt: "2008-09-01T00:00:00.000Z",
        tags: ["one", "two"],
        metadata: { source: "pinboard", hash: "x" },
      },
    ];
    const result = importBatchInput.parse({
      runId: "0".repeat(64),
      batchIndex: 0,
      digest: "0".repeat(64),
      records: original,
    });
    expect(stableJson(original)).toBe(stableJson(result.records));
    expect(stableJson([{ url: "https://another.example" }])).not.toBe(stableJson(original));
  });
});
