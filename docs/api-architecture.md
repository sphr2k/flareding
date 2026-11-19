# API architecture: upstream compatibility and additive overlays

## Source and contract boundaries

- **Linkding v1**: `src/api/linkding/v1/{contract,routes,pagination,favicon-url}.ts`.
  Public routes retain their upstream-style URLs, for example `/api/bookmarks/`
  and `/api/tags/`. Contract is pinned to linkding **v1.47.0**; the upstream
  API is not exposed with a new public version prefix. Input/output validation
  originates from Drizzle/Zod and is covered by compatibility tests.
- **Flareding v1 overlay**: `src/api/flareding/v1/{contract,routes}.ts` keeps
  the extension contracts and implementations separate internally. Public
  extensions use the same `/api/` router.
- **Frontend**: the UI uses the public routes and validates tag and search
  responses with the shared schemas.
- **MCP**: `src/mcp/server.ts` is a Flareding-owned tool surface, not part of
  Linkding REST compatibility. It exposes archive visibility
  through `include_archived: boolean` and typed tool schemas, but retains its
  existing tool names and authorization boundary.
- **Worker/DB**: Linkding operations and Flareding overlay calls share the
  existing Durable Object and Drizzle model. Existing storage keys, data and
  migration versions do not change.

## Compatibility rules

1. `GET /api/tags/` returns tags used by active bookmarks by default.
   `include_archived=true` adds tags used only by archived bookmarks.
   `include_unused=true` independently adds tags with no bookmark associations.
   Both parameters default to `false`; filtering happens before pagination.
   This intentionally differs from upstream linkding's full tag catalog.
2. MCP `list_tags` retains its own filters and authorization boundary.
3. The public REST router enforces the existing API token or authorized
   same-origin browser session.

## Unified search and URL state

The Flareding v1 JSON endpoint `POST /api/bookmarks/search/`
accepts `{query, tags: string[], view, limit, offset}`, validates all fields
with Zod, and returns the existing typed Linkding bookmark DTO/page response.
It evaluates every tag in `tags` as an indexed SQL EXISTS predicate, combined
with AND. Free text searches title, URL, description and notes as before.
This endpoint is an additive overlay: legacy Linkding `/api/bookmarks/` and its
single-tag semantics remain unchanged.

The browser search editor supports `tag:foo` and `tag:"foo bar"` tokens;
native Spectrum suggestions can select names with spaces. Filters appear as
removable chips. Search state is bookmarkable as `?q=...&tag=...&tag=...`
with optional `view` and `offset` parameters, and supports popstate.
Never encode session tokens or private bookmark data in these URLs.
