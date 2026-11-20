import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { bookmarkCreate, bookmarkPatch, bookmarkDto, tagDto } from "../api/linkding/v1/contract.js";
import { authorizeMcp } from "./access.js";
import type { Env } from "../env.js";

const id = z.number().int().positive();
const page = {
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
};
const bookmarkResult = z.object({ bookmark: bookmarkDto });
const deletedResult = z.object({ deleted: z.boolean() });
const pageResult = z.object({
  count: z.number().int().nonnegative(),
  bookmarks: z.array(bookmarkDto),
});
const tagsResult = z.object({
  count: z.number().int().nonnegative(),
  tags: z.array(tagDto.extend({ bookmark_count: z.number().int().nonnegative() })),
});
const mergeResult = z.object({
  target: z.string(),
  target_created: z.boolean(),
  sources_merged: z.array(z.string()),
  sources_not_found: z.array(z.string()),
  bookmarks_affected: z.number().int().nonnegative(),
  error: z.string().optional(),
});
const deleteTagResult = z.object({
  name: z.string(),
  deleted: z.boolean(),
  bookmarks_affected: z.number().int().nonnegative(),
  not_found: z.boolean(),
});

function ok<T extends object>(data: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
  };
}
function error(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const mutating = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

/** Native MCP tools call the same Durable Object methods as linkding's REST API. */
export function createFlaredingMcp(env: Pick<Env, "BOOKMARKS">) {
  const account = env.BOOKMARKS.getByName("default");
  const server = new McpServer({
    name: "flareding",
    title: "Flareding Bookmarks",
    version: "1.0.0",
    description:
      "Personal bookmarks and tags. Search uses case-insensitive text matching, not full-text ranking.",
  });

  server.registerTool(
    "search_bookmarks",
    {
      title: "Find bookmarks",
      description:
        "Search saved bookmarks by title, URL, description or notes, optionally filtering by exact tag, unread-only (`unread: true`) or archive status. Results are paginated (maximum 50).",
      inputSchema: z.object({
        query: z.string().trim().max(250).optional(),
        tag: z.string().trim().max(120).optional(),
        unread: z.boolean().optional(),
        archived: z.boolean().default(false),
        ...page,
      }),
      outputSchema: pageResult,
      annotations: readOnly,
    },
    async ({ query, tag, unread, archived, limit, offset }) => {
      const result = await account.listBookmarks({
        limit,
        offset,
        archived,
        ...(query ? { q: query } : {}),
        ...(tag ? { tag } : {}),
        ...(unread ? { unread: true } : {}),
      });
      return ok({ count: result.count, bookmarks: result.results });
    },
  );

  server.registerTool(
    "get_bookmark",
    {
      title: "Get bookmark",
      description: "Retrieve one saved bookmark by numeric ID, including tags and notes.",
      inputSchema: z.object({ id }),
      outputSchema: bookmarkResult,
      annotations: readOnly,
    },
    async ({ id }) => {
      const bookmark = await account.getBookmark(id);
      return bookmark ? ok({ bookmark }) : error("Bookmark not found");
    },
  );

  server.registerTool(
    "create_bookmark",
    {
      title: "Save bookmark",
      description:
        "Create a bookmark, or update the existing bookmark when its URL is already saved. Optional tag_names replaces the tag set on an existing bookmark.",
      inputSchema: bookmarkCreate,
      outputSchema: bookmarkResult,
      annotations: mutating,
    },
    async (input) => ok({ bookmark: await account.saveBookmark(input) }),
  );

  server.registerTool(
    "update_bookmark",
    {
      title: "Update bookmark",
      description: "Patch the specified bookmark; supplied tag_names replaces its tag set.",
      inputSchema: bookmarkPatch.extend({ id }),
      outputSchema: bookmarkResult,
      annotations: mutating,
    },
    async ({ id, ...patch }) => {
      const bookmark = await account.patchBookmark(id, patch);
      if (!bookmark) return error("Bookmark not found");
      if ("conflict" in bookmark) return error("A bookmark with this URL already exists.");
      return ok({ bookmark });
    },
  );

  server.registerTool(
    "archive_bookmark",
    {
      title: "Archive or restore bookmark",
      description: "Archive or unarchive the specified bookmark.",
      inputSchema: z.object({ id, archived: z.boolean() }),
      outputSchema: bookmarkResult,
      annotations: mutating,
    },
    async ({ id, archived }) => {
      const bookmark = await account.setArchived(id, archived);
      return bookmark ? ok({ bookmark }) : error("Bookmark not found");
    },
  );

  server.registerTool(
    "archive_bookmarks",
    {
      title: "Archive or restore bookmarks in batches",
      description:
        "Archive or unarchive up to 500 bookmark IDs. Each ID is processed independently in order; updated=false means not found unless an error is supplied. Duplicate IDs are processed repeatedly.",
      inputSchema: z.object({ ids: z.array(id).min(1).max(500), archived: z.boolean() }),
      outputSchema: z.object({
        results: z.array(z.object({ id, updated: z.boolean(), error: z.string().optional() })),
      }),
      annotations: mutating,
    },
    async ({ ids, archived }) => ok({ results: await account.setArchivedBatch(ids, archived) }),
  );

  server.registerTool(
    "delete_bookmark",
    {
      title: "Permanently delete bookmark",
      description:
        "Permanently delete the specified bookmark and its tag associations. This cannot be undone.",
      inputSchema: z.object({ id }),
      outputSchema: deletedResult,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ id }) => ok({ deleted: await account.deleteBookmark(id) }),
  );

  server.registerTool(
    "list_tags",
    {
      title: "List bookmark tags with usage counts",
      description:
        "List tags used by active bookmarks. include_archived=false by default; true adds archived and unused tags. bookmark_count counts active bookmarks by default or all bookmark associations when true. Filtering and pagination apply after counts.",
      inputSchema: z.object({
        query: z.string().trim().max(120).optional(),
        min_count: z.number().int().min(0).optional(),
        max_count: z.number().int().min(0).optional(),
        include_archived: z.boolean().default(false),
        sort: z.enum(["name", "count", "date_added"]).default("name"),
        order: z.enum(["asc", "desc"]).default("asc"),
        limit: z.number().int().min(1).max(500).default(20),
        offset: page.offset,
      }),
      outputSchema: tagsResult,
      annotations: readOnly,
    },
    async ({ query, min_count, max_count, include_archived, sort, order, limit, offset }) => {
      const result = await account.listMcpTags({
        limit,
        offset,
        includeArchived: include_archived,
        sort,
        order,
        ...(query ? { q: query } : {}),
        ...(min_count !== undefined ? { minCount: min_count } : {}),
        ...(max_count !== undefined ? { maxCount: max_count } : {}),
      });
      return ok({ count: result.count, tags: result.results });
    },
  );

  server.registerTool(
    "merge_tags",
    {
      title: "Merge or rename tags in batches",
      description:
        "Merge up to 500 source-to-target mappings in one call. Rename is a one-source merge; target is created when absent. Case-only renames canonicalize existing spelling variants. Each mapping commits atomically and a failed mapping does not roll back others. dry_run previews the full batch sequentially without writes. Bookmark date_modified never changes.",
      inputSchema: z.object({
        merges: z
          .array(
            z
              .object({
                sources: z.array(z.string()),
                target: z.string(),
              })
              .strict(),
          )
          .max(500),
        dry_run: z.boolean().default(false),
      }),
      outputSchema: z.object({ dry_run: z.boolean(), results: z.array(mergeResult) }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ merges, dry_run }) =>
      ok({
        dry_run,
        results: await account.mergeMcpTags(merges, dry_run),
      }),
  );

  server.registerTool(
    "delete_tags",
    {
      title: "Delete unused or unwanted tags in batches",
      description:
        "Delete up to 500 named tags and their bookmark associations, preserving bookmarks and date_modified. dry_run previews deletions without writing; deleted=true then means 'would delete'. Names are matched exactly.",
      inputSchema: z.object({
        names: z.array(z.string().trim().min(1).max(120)).max(500),
        dry_run: z.boolean().default(false),
      }),
      outputSchema: z.object({ dry_run: z.boolean(), results: z.array(deleteTagResult) }),
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ names, dry_run }) =>
      ok({
        dry_run,
        results: await account.deleteMcpTags(names, dry_run),
      }),
  );
  return server;
}

/** Route mounted in the existing Worker, not a second Durable Object or Worker. */
export async function handleMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  keySource?: Parameters<typeof authorizeMcp>[2],
): Promise<Response> {
  const unauthorized = await authorizeMcp(request, env, keySource);
  if (unauthorized) return unauthorized;
  const handler = createMcpHandler(() => createFlaredingMcp(env), {
    corsOptions: false,
  });
  const response = await handler(request, env, ctx);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
