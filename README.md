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

## Cost-conscious queries and UI navigation

The bookmark list now executes at most **three SQL statements per page**:
a count, one bounded bookmark page and one bulk tag-join for all visible bookmark
IDs (not an N+1 query per card). A 60-item page previously executed 62 statements
including one query per bookmark. The actual Cloudflare billable rows-read
depends on the returned rows and index access paths, not only query count.

- Filter collections with native Adobe Spectrum 2 Tabs: All / Unread / Archived.
- Filter by exact tag name using indexed relational lookup.
- 350ms debounced free-text and tag searches; cached pages for 15 seconds.
- No full-data read or reimport is needed; all changes are read-only until
  a user explicitly saves or archives a bookmark.

The Workers Paid account subscription is active, but plan activation does not
remove the need for bounded queries and monitoring.

## Cloudflare Access / OIDC rollout (staging, planned)

The application supports a verified Cloudflare Access-to-HttpOnly-session
exchange at `POST /auth/access/session`. It requires these **separate**
Cloudflare Worker secrets (not committed):

- `ACCESS_TEAM_DOMAIN`: expected HTTPS issuer ending in `.cloudflareaccess.com`
- `ACCESS_AUD`: exactly the staging UI application's audience tag
- `ACCESS_ALLOWED_EMAIL`: explicitly authorized identity
- `SESSION_SECRET`: independent high-entropy HMAC cookie key, **not** API_TOKEN

The app validates Access RS256 JWT signing keys, expected issuer/audience,
email allowlist and browser Origin. A partial configuration fails closed.
When configured, the SPA requests a session after Cloudflare login;
the API token is never sent to the browser and the token-based web-login form
is disabled.

Important: **Do not enable Worker-level Access** on Flareding: it would intercept
linkding clients before they can send their ordinary Authorization: Token
header. Configure a **hostname-scoped Access UI application** and a
more-specific `/api/*` Access Bypass rule. Bypass only disables the Cloudflare
login prompt; the Worker still enforces its existing token/session auth.
The `/auth/*` path must remain protected by Access.

The Cloudflare account already has existing Google Apps and one-time PIN
identity providers. Access policies are managed separately through the
`cf zero-trust` CLI. Roll out the bypass first and verify token clients,
then enable UI Access/identity validation. Do not broadly allow everyone to
authenticate into a bookmark application.

### Safe environment-specific Cloudflare bindings

Default and normal staging releases require only the existing API_TOKEN.
Privileged bindings are never required during ordinary deployment:

- staging-import mode is intended only for local import integration tests.
- staging-access mode adds the Access JWT/session keys for a dedicated
  owner-only pilot. Use it only after a specific Access bypass app has been
  verified to preserve the original Token API.
- staging mode keeps both privileged capabilities absent by default.

After Access secrets are deployed, a plain Worker code redeploy must not
be assumed to revoke them. Use cf workers secrets delete for rollback.

## Cloudflare-managed Git deployments

The existing `flareding-staging` Worker is connected to GitHub (`sphr2k/flareding`, branch `main`) through **Cloudflare Workers Builds**. Builds run `bun run build`, then deploy with `bun run deploy:staging`; Preview Builds are disabled, and the existing SQLite Durable Object is retained.

Cloudflare Workers Builds determines the runtime from `.node-version` and Bun from `packageManager` in `package.json`. **Do not add `npm:cf` to `.tool-versions`**: the hosted image fails when trying to install that mise plugin. Locally, invoke `cf` via the pinned project `devDependency` or an explicitly selected `mise` tool.

GitHub Actions continues to check TypeScript, lint, tests and real workerd before merges. Cloudflare then performs the actual staging deployment from `main`.
