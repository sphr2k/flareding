# Flareding

Cloudflare-native, linkding-compatible personal bookmark service.

Status: authenticated bookmark/tag REST API and a functional Adobe React
Spectrum 2 UI. This is a **subset** of linkding: asset upload, URL metadata
scraping, all search operators, bulk operations and full client compatibility
remain tracked in GitHub Issues.

## Architecture

- Runtime: Cloudflare Worker + one SQLite Durable Object per account, native DO RPC.
- Persistence: Drizzle 1.x durable-sqlite and versioned Drizzle Kit migrations.
- Validation: Zod 4 CRUD validators generated from Drizzle. Separate linkding field mappings only.
- HTTP: oRPC v2 OpenAPIHandler; external REST compatible URLs and response DTOs.
- UI: React 19 + Adobe React Spectrum 2. No Tailwind, shadcn or duplicate UI kit.
- Tooling: Bun 1.4.3, TypeScript 7 via bun check, Vite+ tests/lint/format, cf CLI.

## Development

Pinned Cloudflare CLI requires Node 24.22.1.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format:check
bun run db:check
bun run test
bun run build
bun run test:integration  # real workerd and SQLite DO via cf dev
bun run dev
```

Drizzle applies generated migrations from drizzle/migrations in the Durable
Object constructor. The migration postprocessor rewrites SQL imports with ?raw
so the Worker receives SQL text, not asset URLs.

## Authentication

All bookmark/tag APIs require Authorization: Token <your-token> or an authenticated
same-origin session. The Worker requires a Cloudflare API_TOKEN secret.
Unconfigured authentication fails closed with HTTP 503.

React Spectrum login accepts a token once and exchanges it for a signed,
12-hour HttpOnly, Secure, SameSite=Strict cookie. No token is saved in browser
storage. Cookie-authenticated mutation requests require same-origin Origin.
Rotating API_TOKEN revokes sessions. REST token authentication remains available
for original linkding clients independently of the UI.

For local development, provide a Git-ignored .dev.vars containing the secret:

```text
API_TOKEN=<cryptographically-random-token-at-least-32-characters>
```

Configure staging with cf deploy --mode staging --secrets-file <private-JSON>.
Never commit credentials, bookmark exports or browser cookies.

## linkding subset

Implemented: list, create/upsert, get, patch/put, delete, archived list,
archive/unarchive, tag list/create/delete, pagination and basic text search.
Numeric IDs, linkding tag_names and date_added/date_modified fields are emitted.
Responses containing personal data use Cache-Control: private, no-store.

Not yet implemented: metadata scraping, FTS5, advanced search syntax, bookmark
check, assets and full HTTP contract coverage.

## UI

Only Adobe React Spectrum 2. The official page.css sets full-page dark mode;
layout and typography use Spectrum tokens. The React SPA provides token login,
search, create bookmarks, tag display, archive/unarchive and logout.

## Tracking

- Roadmap: https://github.com/sphr2k/flareding/issues/1
- API auth: https://github.com/sphr2k/flareding/issues/5
- Linkding REST: https://github.com/sphr2k/flareding/issues/4
- UI: https://github.com/sphr2k/flareding/issues/11

The LLM tag harmonizer remains a separate downstream component.

## Import planning for personal Pinboard export

A private Pinboard JSON export is available under `/workspace/pinboard`. Do not
commit that export, snippets of personal bookmarks, generated screenshots with
private content, or a raw transformed copy.

Dry-run only:

```sh
bun run pinboard:dry-run /workspace/pinboard/pinboard_export.2026.11.11_09.05.json
```

The dry-run prints **aggregates only**. The 2026-11-11 export has 8,245
bookmarks, 6,719 distinct tags and 25,655 raw assignments. Of those, 8,231
HTTP(S) entries can be mapped to current linkding DTOs. The remaining 14
legacy schemes (6 ftp, 7 javascript, 1 about) require review; they are not
uploaded or rendered as clickable executable URLs.

The mapping preserves original date_added, title, description, shared/privacy
and unread semantics. Full import needs a dedicated idempotent batch endpoint
to preserve the original creation timestamp. **No personal export has yet been
uploaded to Staging.** Track it in #13.

## Spectrum 2 UI concept

Design follows the official Spectrum 2 CardView collection pattern:

- Default: `CardView` / `Card`, compact S grid, showing title, domain,
  short description, a few tags and an ActionMenu.
- Alternate: compact list view. Switch using the native Spectrum controls.
- Native keyboard and collection semantics instead of custom card interactions.
- 60-item server-side pagination: never download all 8,245 bookmarks to render
  the grid; searchable tags and richer facets will be incremental.
- Upcoming: SideNav, tag facet search, native multi-selection with ActionBar and
  responsive details panel. Track #15.

Optional real Chromium smoke:

```sh
bunx playwright install chromium
bun run test:browser
```

It seeds only synthetic bookmarks into a local SQLite DO and cleans up.

## Pinboard import (Staging only)

A private Pinboard JSON export is available at
`/workspace/pinboard/pinboard_export.2026.11.11_09.05.json`.
The source and any transformed rows must never be committed or printed in logs.

The import endpoint requires **two independent secrets**:

- `API_TOKEN`: existing linkding API credential
- `IMPORT_SECRET`: separate high-entropy admin import credential

Both must be configured through Cloudflare Secret bindings. A valid web-session
cookie or API token by itself cannot call the admin import endpoint. Production
has no import secret by default, making the endpoint inaccessible there.

The admin import protocol is restartable: 50 documents per transaction;
each batch includes its deterministic SHA-256 digest and a source-file-based
run identifier. Every transaction commits bookmarks, tag relations and an
`import_batches` checkpoint atomically. Replaying the same batch returns
the stored outcome without overwriting edits to imported bookmarks.
Changed payloads with the same batch index fail with HTTP 409.

Prepare a private Git-ignored `.secrets/staging.json` containing both secrets.
Do not copy this file to CI or the repository. In the project environment:

```sh
bun run pinboard:dry-run /workspace/pinboard/pinboard_export.2026.11.11_09.05.json
bun run pinboard:import -- --source /workspace/pinboard/pinboard_export.2026.11.11_09.05.json
bun run pinboard:import -- --source /workspace/pinboard/pinboard_export.2026.11.11_09.05.json --apply
bun run pinboard:import -- --source /workspace/pinboard/pinboard_export.2026.11.11_09.05.json --verify-only
```

The CLI refuses to write to non-staging hosts, checks that the target is empty
or exclusively contains checkpoints from the same import run, uses bounded
retries, and verifies final bookmark counts, private/unread status, tag
relations, original timestamp range, checkpoint count and source-derived
cardinality. A finalization call removes orphan tags left by deleted test data
**only after aggregate verification passes**.

The original export is retained and 14 non-HTTP(S) legacy entries remain
quarantined rather than being rendered as browser-executable links.

The privileged import secret should be disabled/removed after final validation.
