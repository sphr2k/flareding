import { z } from "zod";

/** Pinboard's official JSON export. Never log fields containing personal URLs. */
export const pinboardEntry = z
  .object({
    href: z.string().min(1),
    description: z.string(),
    extended: z.string(),
    time: z.iso.datetime({ offset: true }),
    shared: z.enum(["yes", "no"]),
    toread: z.enum(["yes", "no"]),
    tags: z.string(),
    hash: z.string().optional(),
    meta: z.string().optional(),
  })
  .passthrough();

export type PinboardBookmark = {
  url: string;
  title: string;
  description: string;
  notes: string;
  shared: boolean;
  unread: boolean;
  createdAt: Date;
  tags: string[];
  metadata: Record<string, string>;
};

/** Only HTTP(S) URLs may become clickable/bookmark API records. */
const browserUrl = z.url({ protocol: /^https?$/ });

export type PinboardPlan = {
  entries: PinboardBookmark[];
  unsupported: Array<{ recordIndex: number; scheme: string }>;
  stats: {
    received: number;
    importable: number;
    unsupported: number;
    invalid: number;
    duplicateUrls: number;
    distinctTags: number;
    tagAssignments: number;
    private: number;
    unread: number;
    firstYear: number | null;
    lastYear: number | null;
  };
};

export function planPinboardImport(input: unknown): PinboardPlan {
  if (!Array.isArray(input)) throw new TypeError("Pinboard export must be a JSON array");
  const entries: PinboardBookmark[] = [];
  const unsupported: PinboardPlan["unsupported"] = [];
  const uniqueUrls = new Set<string>();
  const allTags = new Set<string>();
  let invalid = 0;
  let duplicateUrls = 0;
  let totalAssignments = 0;
  let privateCount = 0;
  let unreadCount = 0;
  let earliestYear = Number.POSITIVE_INFINITY;
  let latestYear = Number.NEGATIVE_INFINITY;
  for (const [recordIndex, record] of input.entries()) {
    const parsed = pinboardEntry.safeParse(record);
    if (!parsed.success) {
      invalid++;
      continue;
    }
    const row = parsed.data;
    if (uniqueUrls.has(row.href)) {
      duplicateUrls++;
      continue;
    }
    uniqueUrls.add(row.href);
    const parsedUrl = browserUrl.safeParse(row.href);
    if (!parsedUrl.success) {
      let scheme = "invalid";
      try {
        scheme = new URL(row.href).protocol.replace(/:$/, "").toLowerCase();
      } catch {
        /* invalid URL */
      }
      unsupported.push({ recordIndex, scheme });
      continue;
    }
    const tags = [
      ...new Set(
        row.tags
          .split(/\s+/u)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    totalAssignments += tags.length;
    tags.forEach((tag) => allTags.add(tag));
    if (row.shared === "no") privateCount++;
    if (row.toread === "yes") unreadCount++;
    const timestamp = new Date(row.time);
    const year = timestamp.getUTCFullYear();
    earliestYear = Math.min(earliestYear, year);
    latestYear = Math.max(latestYear, year);
    entries.push({
      url: row.href,
      title: row.description || row.href,
      description: row.extended,
      notes: "",
      shared: row.shared === "yes",
      unread: row.toread === "yes",
      createdAt: timestamp,
      tags,
      metadata: {
        source: "pinboard",
        ...(row.hash === undefined ? {} : { hash: row.hash }),
        ...(row.meta === undefined ? {} : { meta: row.meta }),
      },
    });
  }
  return {
    entries,
    unsupported,
    stats: {
      received: input.length,
      importable: entries.length,
      unsupported: unsupported.length,
      invalid,
      duplicateUrls,
      distinctTags: allTags.size,
      tagAssignments: totalAssignments,
      private: privateCount,
      unread: unreadCount,
      firstYear: Number.isFinite(earliestYear) ? earliestYear : null,
      lastYear: Number.isFinite(latestYear) ? latestYear : null,
    },
  };
}
