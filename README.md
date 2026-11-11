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
