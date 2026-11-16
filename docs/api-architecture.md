# API architecture: upstream compatibility and additive overlays

## Source and contract boundaries

- **Linkding v1**: `src/api/linkding/v1/{contract,routes,pagination,favicon-url}.ts`.
  Public routes retain their upstream-style URLs, for example `/api/bookmarks/`
  and `/api/tags/`. Contract is pinned to linkding **v1.47.0**; the upstream
  API is not exposed with a new public version prefix. Input/output validation
  originates from Drizzle/Zod and is covered by compatibility tests.
- **Flareding v1 overlay**: `src/api/flareding/v1/{contract,routes}.ts`. All new
  extension routes use `/api/flareding/v1/*`, with their own Zod input/output
  schemas. Reusing upstream DTOs is allowed; modifying them to implement an
  extension is not. Breaking changes to this namespace require a new version.
- **Frontend**: `src/ui/lib/flareding-v1-client.ts` validates responses at
  runtime against the same versioned overlay contract. The UI uses the overlay
  only when it needs Flareding behavior, otherwise uses legacy Linkding routes.
- **MCP**: `src/mcp/server.ts` is a Flareding-owned tool surface, not part of
  Linkding REST compatibility. It exposes the same archive-visibility semantics
  through `include_archived: boolean` and typed tool schemas, but retains its
  existing tool names and authorization boundary.
- **Worker/DB**: Linkding operations and Flareding overlay calls share the
  existing Durable Object and Drizzle model. Existing storage keys, data and
  migration versions do not change.

## Compatibility rules

1. The Linkding v1 contracts and public routes are not changed for a Flareding
   feature. Linkding `GET /api/tags/` continues to list every tag, including
   archived-only and unused tags, just as before this overlay.
2. New fields, filtering behavior and endpoints live exclusively under the
   `/api/flareding/v1/*` namespace, with explicit contracts and independent
   regression tests. Existing upstream endpoints never depend on the overlay.
3. The Flareding v1 tag endpoint `GET /api/flareding/v1/tags/` accepts
   `include_archived=false|true` (default `false`). With `false`, only
   tags used by at least one non-archived bookmark are returned. With `true`,
   the complete catalog is returned, including archived-only and unused tags.
4. MCP `list_tags` applies the same flag to tag visibility and
   `bookmark_count`: active associations with `false`, all associations
   with `true`. It never rewrites stored tag associations.
5. Authentication is unchanged: both REST namespaces enforce the worker's
   existing static API Token or authorized same-origin browser session.

## Unified search and URL state

The Flareding v1 JSON endpoint `POST /api/flareding/v1/bookmarks/search/`
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
