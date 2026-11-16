import { describe, expect, it } from "vite-plus/test";
import {
  consumeTagSyntax,
  pendingTag,
  stripPendingTag,
  readSearchState,
  writeSearchState,
} from "../src/ui/lib/search-filters.js";

describe("unified search tag syntax", () => {
  it("recognizes unfinished tag fragments without adding a filter too early", () => {
    expect(pendingTag("kafka tag:kuber")).toBe("kuber");
    expect(pendingTag('kafka tag:"two words')).toBe("two words");
    expect(pendingTag("kafka alone")).toBeNull();
    expect(stripPendingTag("kafka tag:kuber")).toBe("kafka");
  });
  it("consumes quoted spaces and multiple complete tokens without losing text search", () => {
    expect(consumeTagSyntax('kafka tag:kubernetes tag:"two words"')).toEqual({
      query: "kafka ",
      tags: ["kubernetes", "two words"],
    });
    expect(consumeTagSyntax("kafka tag:unfinished")).toEqual({
      query: "kafka tag:unfinished",
      tags: [],
    });
    expect(consumeTagSyntax("tag:kubernetes ")).toEqual({ query: " ", tags: ["kubernetes"] });
  });
  it("roundtrips free text, multiple space-containing tags, view and offset in browser URL", () => {
    const state = {
      query: "kafka",
      tags: ["Kubernetes", "machine learning"],
      view: "archived" as const,
      offset: 120,
    };
    const encoded = writeSearchState("?other=keep&tag=old", state);
    expect(readSearchState("?" + encoded)).toEqual(state);
    expect(new URLSearchParams(encoded).get("other")).toBe("keep");
  });
});
