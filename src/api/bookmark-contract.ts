import { z } from "zod";
import { bookmarkInsertSchema, bookmarkUpdateSchema, tagInsertSchema } from "../db/validation.js";

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
  .extend({
    url: z.url({ protocol: /^https?$/ }).max(8192),
    is_archived: z.boolean().optional(),
    unread: z.boolean().optional(),
    shared: z.boolean().optional(),
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
});

export const tagDto = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  date_added: z.string().datetime(),
});

export const tagCreate = tagInsertSchema.pick({ name: true }).extend({
  name: z.string().trim().min(1).max(120),
});

export const pageInput = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  q: z.string().optional(),
});

export const bookmarkPageInput = pageInput.extend({
  modified_since: z.string().datetime().optional(),
  added_since: z.string().datetime().optional(),
});

export const pageOutput = <T extends z.ZodType>(item: T) =>
  z.object({
    count: z.number().int().nonnegative(),
    next: z.string().url().nullable(),
    previous: z.string().url().nullable(),
    results: z.array(item),
  });

export type BookmarkCreate = z.infer<typeof bookmarkCreate>;
export type BookmarkPatch = z.infer<typeof bookmarkPatch>;
export type BookmarkDTO = z.infer<typeof bookmarkDto>;
export type TagDTO = z.infer<typeof tagDto>;
