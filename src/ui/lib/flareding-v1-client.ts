import { flaredingV1TagPageOutput } from "../../api/flareding/v1/contract.js";

/** Typed, runtime-validated client for the versioned Flareding API overlay. */
export async function getActiveTagSuggestions(query: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, limit: "100", include_archived: "false" });
  const response = await fetch(`/api/flareding/v1/tags/?${params}`, {
    signal,
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Could not load tag suggestions.");
  return flaredingV1TagPageOutput.parse(await response.json());
}
