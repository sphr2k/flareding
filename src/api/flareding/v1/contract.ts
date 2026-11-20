import { z } from "zod";
import { bookmarkDto, pageOutput } from "../../linkding/v1/contract.js";

/** Additive, JSON-based multi-tag search. Linkding v1 filtering is unchanged. */
export const flaredingV1BookmarkSearchInput = z
  .object({
    query: z.string().trim().max(1000).default(""),
    tags: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    bundle: z.number().int().positive().optional(),
    view: z.enum(["all", "unread", "archived"]).default("all"),
    limit: z.number().int().min(1).max(100).default(60),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

export const flaredingV1BookmarkSearchOutput = pageOutput(bookmarkDto);
export type FlaredingV1BookmarkSearch = z.output<typeof flaredingV1BookmarkSearchInput>;
export type FlaredingV1BookmarkSearchPage = z.output<typeof flaredingV1BookmarkSearchOutput>;
