import { tagPageOutput } from "../../api/linkding/v1/contract.js";

/** Typed, runtime-validated client for the tag suggestion endpoint. */
export async function getActiveTagSuggestions(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, limit: "100", include_archived: "false" });
  const response = await fetch(`/api/tags/?${params}`, {
    signal,
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Could not load tag suggestions.");
  return tagPageOutput.parse(await response.json());
}
