import { z } from "zod";
import { bookmarkDto, pageInput, pageOutput, tagDto } from "../../linkding/v1/contract.js";

/** Flareding v1 is additive and independent from the upstream Linkding v1 route contract. */
export const flaredingV1TagPageInput = pageInput.extend({
  include_archived: z
    .enum(["false", "true"])
    .default("false")
    .transform((v) => v === "true"),
});

export const flaredingV1TagPageOutput = pageOutput(tagDto);
export type FlaredingV1TagPage = z.output<typeof flaredingV1TagPageOutput>;

/** Additive, JSON-based multi-tag search. Linkding v1 filtering is unchanged. */
export const flaredingV1BookmarkSearchInput = z
  .object({
    query: z.string().trim().max(1000).default(""),
    tags: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    view: z.enum(["all", "unread", "archived"]).default("all"),
    limit: z.number().int().min(1).max(100).default(60),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

export const flaredingV1BookmarkSearchOutput = pageOutput(bookmarkDto);
export type FlaredingV1BookmarkSearch = z.output<typeof flaredingV1BookmarkSearchInput>;
export type FlaredingV1BookmarkSearchPage = z.output<typeof flaredingV1BookmarkSearchOutput>;
