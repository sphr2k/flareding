import { createInsertSchema } from "drizzle-orm/zod";
import { bundles } from "../../../db/schema.js";
import { z } from "zod";
import {
  bookmarkInsertSchema,
  bookmarkUpdateSchema,
  tagInsertSchema,
} from "../../../db/validation.js";

/**
 * External linkding DTOs intentionally differ from the Drizzle column names.
 * Shared database fields retain their automatically generated Zod validators.
 */
const editable = bookmarkInsertSchema.pick({
  url: true,
  title: true,
  description: true,
  notes: true,
});

export const bookmarkCreate = editable
  .partial({ title: true })
  .extend({
    url: z.url({ protocol: /^https?$/ }).max(8192),
    is_archived: z.boolean().optional(),
    unread: z.boolean().optional(),
    shared: z.boolean().optional(),
    date_added: z.iso.datetime({ offset: true }).optional(),
    date_modified: z.iso.datetime({ offset: true }).optional(),
    tag_names: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  })
  .strict();

export const bookmarkPatch = bookmarkUpdateSchema
  .pick({ url: true, title: true, description: true, notes: true })
  .extend({
    url: z
      .url({ protocol: /^https?$/ })
      .max(8192)
      .optional(),
    is_archived: z.boolean().optional(),
    unread: z.boolean().optional(),
    shared: z.boolean().optional(),
    date_added: z.iso.datetime({ offset: true }).optional(),
    date_modified: z.iso.datetime({ offset: true }).optional(),
    tag_names: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  })
  .strict();

export const bookmarkDto = z.object({
  id: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  description: z.string(),
  notes: z.string(),
  is_archived: z.boolean(),
  unread: z.boolean(),
  shared: z.boolean(),
  tag_names: z.array(z.string()),
  date_added: z.string().datetime(),
  date_modified: z.string().datetime(),
  web_archive_snapshot_url: z.string().nullable(),
  favicon_url: z.string().nullable(),
  preview_image_url: z.string().nullable(),
  website_title: z.null().optional(),
  website_description: z.null().optional(),
});

export const tagDto = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  date_added: z.string().datetime(),
});

export const tagCreate = tagInsertSchema.pick({ name: true }).extend({
  name: z.string().trim().min(1).max(120),
});

/** linkding v1.47.0 uses DRF LimitOffsetPagination, default 100, no max_limit.
 * Invalid limit/offset values fall back rather than becoming validation errors.
 */
function paginationInteger(value: unknown, fallback: number, strict: boolean): number {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  if (!/^[+-]?\d(?:_?\d)*$/.test(text)) return fallback;
  const parsed = Number(text.replaceAll("_", ""));
  return Number.isInteger(parsed) && parsed >= (strict ? 1 : 0) ? parsed : fallback;
}

export const pageInput = z.object({
  limit: z.preprocess((value) => paginationInteger(value, 100, true), z.number()),
  offset: z.preprocess((value) => paginationInteger(value, 0, false), z.number()),
  q: z.string().optional(),
});

export const tagPageInput = pageInput.extend({
  include_archived: z
    .enum(["false", "true"])
    .default("false")
    .transform((value) => value === "true"),
  include_unused: z
    .enum(["false", "true"])
    .default("false")
    .transform((value) => value === "true"),
});

const bookmarkSorts = [
  "added_desc",
  "added_asc",
  "modified_desc",
  "modified_asc",
  "title_desc",
  "title_asc",
] as const;
export type BookmarkSort = (typeof bookmarkSorts)[number];

export const bookmarkPageInput = pageInput.extend({
  tag: z.string().trim().max(120).optional(),
  unread: z
    .enum(["true", "false", "yes", "no", "off"])
    .transform((value) =>
      value === "yes" || value === "true" ? true : value === "no" ? false : undefined,
    )
    .optional(),
  shared: z
    .enum(["yes", "no", "off"])
    .transform((value) => (value === "off" ? undefined : value === "yes"))
    .optional(),
  bundle: z.coerce.number().int().positive().optional(),
  sort: z.enum(bookmarkSorts).catch("added_desc").optional(),
  modified_since: z.iso.datetime({ offset: true }).optional().catch(undefined),
  added_since: z.iso.datetime({ offset: true }).optional().catch(undefined),
});

export const pageOutput = <T extends z.ZodType>(item: T) =>
  z.object({
    count: z.number().int().nonnegative(),
    next: z.string().url().nullable(),
    previous: z.string().url().nullable(),
    results: z.array(item),
  });

export const tagPageOutput = pageOutput(tagDto);

export type BookmarkCreate = z.infer<typeof bookmarkCreate>;
export type BookmarkPatch = z.infer<typeof bookmarkPatch>;
export type BookmarkDTO = z.infer<typeof bookmarkDto>;
export type TagDTO = z.infer<typeof tagDto>;

export const bundleCreate = createInsertSchema(bundles, {
  name: (schema) => schema.trim().min(1).max(256),
  search: (schema) => schema.max(256),
  any_tags: (schema) => schema.max(1024),
  all_tags: (schema) => schema.max(1024),
  excluded_tags: (schema) => schema.max(1024),
})
  .omit({ id: true, date_created: true, date_modified: true })
  .partial({ order: true });
export const bundlePatch = bundleCreate.partial();
export type BundleCreate = z.infer<typeof bundleCreate>;
export type BundlePatch = z.infer<typeof bundlePatch>;
