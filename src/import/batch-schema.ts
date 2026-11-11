import { z } from "zod";
import { bookmarkInsertSchema } from "../db/validation.js";

/** Restricted import DTO derived from Drizzle's insert schema. */
export const importRecord = bookmarkInsertSchema
  .pick({
    url: true,
    title: true,
    description: true,
    notes: true,
    shared: true,
    isUnread: true,
    createdAt: true,
    metadata: true,
  })
  .extend({
    url: z.url({ protocol: /^https?$/ }).max(8192),
    title: z.string().min(1).max(8192),
    description: z.string().max(100_000),
    notes: z.string().max(100_000),
    isUnread: z.boolean(),
    shared: z.boolean(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime({ offset: true }),
    tags: z.array(z.string().trim().min(1).max(120)).max(100),
  })
  .strict();

export const importBatchInput = z.strictObject({
  runId: z.string().regex(/^[0-9a-f]{64}$/),
  batchIndex: z.number().int().min(0),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  records: z.array(importRecord).min(1).max(50),
});
export type ImportBatchInput = z.infer<typeof importBatchInput>;
export type ImportBatchResult = {
  replay: boolean;
  inserted: number;
  skipped: number;
  recordCount: number;
};

export type ImportStats = {
  totalBookmarks: number;
  privateBookmarks: number;
  unreadBookmarks: number;
  tags: number;
  tagAssignments: number;
  firstDate: string | null;
  lastDate: string | null;
  completedBatches: number;
  importedRecords: number;
  insertedRecords: number;
  skippedRecords: number;
};
