import { describe, expect, it } from "vite-plus/test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { handleMcp } from "../src/mcp/server.js";
import { authorizeMcp } from "../src/mcp/access.js";
import type { Env } from "../src/env.js";

const issuer = "https://janw.cloudflareaccess.com";
const audience = "flareding-mcp-staging-audience";
const endpoint = "https://flareding-staging.janwer.workers.dev/mcp";
const fixture = {
  id: 42,
  url: "https://example.com/test",
  title: "Example",
  description: "Test bookmark",
  notes: "",
  is_archived: false,
  unread: false,
  shared: false,
  tag_names: ["docs"],
  date_added: "2026-11-16T00:00:00.000Z",
  date_modified: "2026-11-16T00:00:00.000Z",
  web_archive_snapshot_url: null,
  favicon_url: null,
  preview_image_url: null,
};
const context = { waitUntil: (_promise: Promise<unknown>) => {} } as ExecutionContext;

function request(method: string, params: object = {}, jwt?: string) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "flareding-staging.janwer.workers.dev",
      Accept: "application/json, text/event-stream",
      ...(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function signed(aud = audience, iss = issuer) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test";
  const token = await new SignJWT({ type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { token, keys: createLocalJWKSet({ keys: [jwk] }) };
}

function env() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const store = {
    listBookmarks: async (...args: unknown[]) => {
      calls.push({ op: "listBookmarks", args });
      return { count: 1, results: [fixture] };
    },
    getBookmark: async (id: number) => (id === 42 ? fixture : null),
    saveBookmark: async (input: object) => {
      calls.push({ op: "saveBookmark", args: [input] });
      return fixture;
    },
    patchBookmark: async (id: number, patch: object) => {
      calls.push({ op: "patchBookmark", args: [id, patch] });
      return id === 42 ? fixture : null;
    },
    setArchived: async (id: number, archived: boolean) => {
      calls.push({ op: "setArchived", args: [id, archived] });
      return fixture;
    },
    setArchivedBatch: async (ids: number[], archived: boolean) => {
      calls.push({ op: "setArchivedBatch", args: [ids, archived] });
      return ids.map((id) => ({ id, updated: id === 42 }));
    },
    deleteBookmark: async (id: number) => {
      calls.push({ op: "deleteBookmark", args: [id] });
      return true;
    },
    listMcpTags: async (input: object) => {
      calls.push({ op: "listMcpTags", args: [input] });
      return {
        count: 1,
        results: [{ id: 1, name: "docs", date_added: fixture.date_added, bookmark_count: 4 }],
      };
    },
    mergeMcpTags: async (merges: object[], dryRun: boolean) => {
      calls.push({ op: "mergeMcpTags", args: [merges, dryRun] });
      return merges.map((merge) => ({
        target: (merge as { target: string }).target,
        target_created: true,
        sources_merged: (merge as { sources: string[] }).sources,
        sources_not_found: [],
        bookmarks_affected: 3,
      }));
    },
    deleteMcpTags: async (names: string[], dryRun: boolean) => {
      calls.push({ op: "deleteMcpTags", args: [names, dryRun] });
      return names.map((name) => ({
        name,
        deleted: true,
        bookmarks_affected: 1,
        not_found: false,
      }));
    },
  };
  const result = {
    MCP_ACCESS_AUD: audience,
    MCP_ACCESS_ISSUER: issuer,
    BOOKMARKS: {
      getByName: (name: string) => {
        if (name !== "default") throw new Error("Wrong account");
        return store;
      },
    },
  } as unknown as Env;
  return { result, calls };
}

async function mcpPayload(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.headers.get("Content-Type")?.includes("text/event-stream")) return JSON.parse(text);
  const event = text.split(/\r?\n/).find((line) => line.startsWith("data: "));
  if (!event) throw new Error("Missing MCP SSE data event");
  return JSON.parse(event.slice(6));
}

async function tool(
  name: string,
  args: object,
  token: string,
  keys: Awaited<ReturnType<typeof signed>>["keys"],
  environment: Env,
) {
  const response = await handleMcp(
    request("tools/call", { name, arguments: args }, token),
    environment,
    context,
    keys,
  );
  expect(response.status).toBe(200);
  return (await mcpPayload(response)) as {
    result: {
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
      content: Array<{ text: string }>;
    };
  };
}

describe("native MCP access boundary", () => {
  it("fails closed when the issuer or audience is absent or malformed", async () => {
    const missing = await authorizeMcp(request("tools/list"), {}, undefined);
    expect(missing?.status).toBe(503);
    const invalidIssuer = await authorizeMcp(request("tools/list"), {
      MCP_ACCESS_AUD: audience,
      MCP_ACCESS_ISSUER: "http://localhost",
    });
    expect(invalidIssuer?.status).toBe(503);
  });

  it("rejects forged headers, wrong JWT audience, issuer and missing assertions", async () => {
    const { result: environment } = env();
    const { token, keys } = await signed();
    const noAssertion = await authorizeMcp(request("tools/list"), environment, keys);
    expect(noAssertion?.status).toBe(401);
    expect(
      (await authorizeMcp(request("tools/list", {}, "forged"), environment, keys))?.status,
    ).toBe(401);
    expect(
      (
        await authorizeMcp(
          request("tools/list", {}, (await signed("wrong")).token),
          environment,
          keys,
        )
      )?.status,
    ).toBe(401);
    expect(
      (
        await authorizeMcp(
          request(
            "tools/list",
            {},
            (await signed(audience, "https://wrong.cloudflareaccess.com")).token,
          ),
          environment,
          keys,
        )
      )?.status,
    ).toBe(401);
    expect(await authorizeMcp(request("tools/list", {}, token), environment, keys)).toBeNull();
    const denied = await handleMcp(request("tools/list"), environment, context, keys);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("native MCP bookmark tools", () => {
  it("registers ten tools with correct destructive annotations", async () => {
    const { result: environment } = env();
    const { token, keys } = await signed();
    const response = await handleMcp(request("tools/list", {}, token), environment, context, keys);
    expect(response.status).toBe(200);
    const body = await mcpPayload(response);
    expect(body.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "search_bookmarks",
      "get_bookmark",
      "create_bookmark",
      "update_bookmark",
      "archive_bookmark",
      "archive_bookmarks",
      "delete_bookmark",
      "list_tags",
      "merge_tags",
      "delete_tags",
    ]);
    const del = body.result.tools.find((t: { name: string }) => t.name === "delete_bookmark");
    expect(del.annotations.destructiveHint).toBe(true);
    expect(
      body.result.tools.find((t: { name: string }) => t.name === "merge_tags").annotations
        .destructiveHint,
    ).toBe(true);
    expect(
      body.result.tools.find((t: { name: string }) => t.name === "delete_tags").annotations
        .destructiveHint,
    ).toBe(true);
  });

  it("enforces bounded search, invokes native DO RPC and exposes structured results", async () => {
    const { result: environment, calls } = env();
    const { token, keys } = await signed();
    const search = await tool(
      "search_bookmarks",
      { query: "example", limit: 5, tag: "docs" },
      token,
      keys,
      environment,
    );
    expect(search.result.structuredContent?.count).toBe(1);
    expect(calls[0]).toEqual({
      op: "listBookmarks",
      args: [{ limit: 5, offset: 0, archived: false, q: "example", tag: "docs" }],
    });
    const oversized = await tool("search_bookmarks", { limit: 10000 }, token, keys, environment);
    expect(oversized.result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    const tags = await tool("list_tags", { query: "do" }, token, keys, environment);
    expect(tags.result.structuredContent?.count).toBe(1);
    expect(calls[1]).toEqual({
      op: "listMcpTags",
      args: [{ limit: 20, offset: 0, includeArchived: false, sort: "name", order: "asc", q: "do" }],
    });
    expect(
      (tags.result.structuredContent?.tags as Array<{ bookmark_count: number }>)[0]?.bookmark_count,
    ).toBe(4);
  });

  it("archives and restores bounded batches with per-ID results", async () => {
    const { result: environment, calls } = env();
    const { token, keys } = await signed();
    const result = await tool(
      "archive_bookmarks",
      { ids: [42, 999], archived: false },
      token,
      keys,
      environment,
    );
    expect(result.result.structuredContent?.results).toEqual([
      { id: 42, updated: true },
      { id: 999, updated: false },
    ]);
    expect(calls).toEqual([{ op: "setArchivedBatch", args: [[42, 999], false] }]);
    for (const ids of [[], [0], Array.from({ length: 501 }, (_, i) => i + 1)]) {
      const invalid = await tool(
        "archive_bookmarks",
        { ids, archived: true },
        token,
        keys,
        environment,
      );
      expect(invalid.result.isError).toBe(true);
    }
    expect(calls).toHaveLength(1);
  });

  it("validates inputs and delegates all writes to existing DO RPC", async () => {
    const { result: environment, calls } = env();
    const { token, keys } = await signed();
    const create = await tool(
      "create_bookmark",
      { url: fixture.url, title: "Example" },
      token,
      keys,
      environment,
    );
    expect(create.result.structuredContent?.bookmark).toMatchObject({ id: 42 });
    const update = await tool(
      "update_bookmark",
      { id: 42, notes: "new" },
      token,
      keys,
      environment,
    );
    expect(update.result.structuredContent?.bookmark).toMatchObject({ id: 42 });
    await tool("archive_bookmark", { id: 42, archived: true }, token, keys, environment);
    const deleted = await tool("delete_bookmark", { id: 42 }, token, keys, environment);
    expect(deleted.result.structuredContent?.deleted).toBe(true);
    expect(calls.map((call) => call.op)).toEqual([
      "saveBookmark",
      "patchBookmark",
      "setArchived",
      "deleteBookmark",
    ]);
    const bad = await tool(
      "create_bookmark",
      { url: "javascript:alert(1)" },
      token,
      keys,
      environment,
    );
    expect(bad.result.isError).toBe(true);
    expect(calls).toHaveLength(4);
  });
});

describe("native MCP tag-management tools", () => {
  it("paginates, filters and sorts counts up to 500, rejecting larger pages", async () => {
    const { result: environment, calls } = env();
    const { token, keys } = await signed();
    const tags = await tool(
      "list_tags",
      {
        query: "do",
        min_count: 0,
        max_count: 100,
        sort: "count",
        order: "desc",
        limit: 500,
        offset: 20,
      },
      token,
      keys,
      environment,
    );
    expect(tags.result.structuredContent?.count).toBe(1);
    expect(calls).toEqual([
      {
        op: "listMcpTags",
        args: [
          {
            limit: 500,
            offset: 20,
            includeArchived: false,
            sort: "count",
            order: "desc",
            q: "do",
            minCount: 0,
            maxCount: 100,
          },
        ],
      },
    ]);
    const withArchive = await tool(
      "list_tags",
      { include_archived: true, query: "archived" },
      token,
      keys,
      environment,
    );
    expect(withArchive.result.isError).not.toBe(true);
    expect(calls[1]).toMatchObject({
      op: "listMcpTags",
      args: [{ includeArchived: true, q: "archived" }],
    });
    const invalid = await tool("list_tags", { limit: 501 }, token, keys, environment);
    expect(invalid.result.isError).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("passes 500 merge mappings to a single DO RPC and supports dry-run", async () => {
    const { result: environment, calls } = env();
    const { token, keys } = await signed();
    const mappings = Array.from({ length: 500 }, (_, i) => ({
      sources: ["legacy-" + i],
      target: "canonical-" + i,
    }));
    const dry = await tool(
      "merge_tags",
      { merges: mappings, dry_run: true },
      token,
      keys,
      environment,
    );
    expect(dry.result.structuredContent?.dry_run).toBe(true);
    expect((dry.result.structuredContent?.results as unknown[]).length).toBe(500);
    expect(calls).toEqual([{ op: "mergeMcpTags", args: [mappings, true] }]);
    const invalid = await tool(
      "merge_tags",
      {
        merges: [...mappings, { sources: ["oops"], target: "extra" }],
      },
      token,
      keys,
      environment,
    );
    expect(invalid.result.isError).toBe(true);
    expect(calls).toHaveLength(1);
    const write = await tool(
      "merge_tags",
      {
        merges: [{ sources: ["Kubernetes"], target: "kubernetes" }],
      },
      token,
      keys,
      environment,
    );
    expect(write.result.structuredContent?.dry_run).toBe(false);
    expect(calls[1]).toEqual({
      op: "mergeMcpTags",
      args: [[{ sources: ["Kubernetes"], target: "kubernetes" }], false],
    });
  });

  it("supports batch dry-run deletion with 500 maximum names", async () => {
    const { result: environment, calls } = env();
    const { token, keys } = await signed();
    const dry = await tool(
      "delete_tags",
      { names: ["#", "+", "1709"], dry_run: true },
      token,
      keys,
      environment,
    );
    expect(dry.result.structuredContent?.dry_run).toBe(true);
    expect(calls).toEqual([
      {
        op: "deleteMcpTags",
        args: [["#", "+", "1709"], true],
      },
    ]);
    const invalid = await tool(
      "delete_tags",
      {
        names: Array.from({ length: 501 }, (_, i) => String(i)),
      },
      token,
      keys,
      environment,
    );
    expect(invalid.result.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
