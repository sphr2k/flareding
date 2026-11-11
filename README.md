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

## LinkThing compatibility

LinkThing's default Unread view requests `/api/bookmarks/?q=!unread&limit=10&offset=0`.
The standalone `!unread` keyword filters unread bookmarks and can be combined
with a text search; it is not treated as literal text. The existing `unread=true`
parameter remains supported. An empty unread collection is valid when all bookmarks
are marked read; LinkThing's All view requests the unfiltered collection.

Pagination follows linkding v1.47.0: default 100, no configured maximum, invalid
limits fall back to 100 and invalid offsets to 0. `limit=1000000` is accepted
for both bookmarks and tags. LinkThing
currently reads only its first tag page, so this does not guarantee access to more
than 1000 tags within that client. Full linkding search expression support remains
outside this subset. Client compatibility is tracked in #10.

## Spectrum 2 UI concept

The English UI follows Adobe's Spectrum 2 app and CardView examples:

- A viewport-filling app bar and collection rail surround a scrolling content
  surface. Mobile uses collection tabs and keeps Add in the app bar.
- Native waterfall cards preserve variable heights, with titles and descriptions
  limited to three lines. Card/List switching uses Spectrum icons and tooltips.
- Favicons provide a subtle client-only card accent; monochrome icons stay neutral
  and missing icons use a deterministic domain palette. See the bounded styling
  exception in `AGENTS.md`.
- Add and Edit share a native dialog with removable tags, paginated tag suggestions,
  multiline Description/Notes and confirmation before discarding changes.
- `/api/tags/?q=...` filters names by a case-insensitive literal substring, with
  the same filter applied to counts and pagination.
- Native keyboard, focus and collection semantics remain in place. Bookmark
  collections use 60-item server-side pagination.

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

## UI redesign (#21)

The authenticated UI uses Adobe React Spectrum 2 exclusively. It has one
compact AppHeader with brand, global SearchField, AddBookmark DialogTrigger,
and secondary ActionMenu for logout, followed by a CollectionToolbar with native
Tabs, optional tag filter and SegmentedControl.

- Native CardView uses size XL to avoid dense 5-column desktop cards. Site
  fallback is based on the canonical host, never the link path or title.
- On mobile under 640px, automatically use the native Spectrum ListView; its
  documented direct Image/Text/ActionMenu slots keep icon and title readable.
- The first UI iteration generates deterministic, inert local site monograms;
  it does not yet crawl URLs or make third-party icon requests.
- Slash outside text inputs focuses global search; pressing n opens the
  Add Bookmark dialog. Cancel/ESC restores focus through Spectrum semantics.
- Chrome smoke exercises 360/768/1280/1920px with synthetic bookmarks,
  verifies no horizontal overflow and writes ignored screenshots only.

A second PR implements a bounded same-origin favicon resolver with
positive/negative Cloudflare Cache API and strict SSRF controls.

## Site icons (#21)

The Worker provides an authenticated same-origin favicon endpoint at
`GET /api/site-icons/{normalized-host}`. Bookmark REST payloads expose
an absolute `favicon_url` compatible with linkding. The browser sends
its existing HttpOnly session automatically; a regular linkding API client
may use the `Authorization: Token` header. Anonymous image crawling is
rejected before DNS or external HTTP requests.

The resolver runs only for requested/visible icons, not at import, migration,
or background update time. All expensive operations happen outside the
SQLite Durable Object; **zero additional SQL reads or writes per favicon**.

- The favicon key is the canonical host, not the individual bookmark URL.
- Public DNS preflight checks both A and AAAA, following bounded CNAME
  chains while rejecting private, loopback, link-local and reserved addresses.
  Every redirect target goes through the same checks. DNS preflight alone
  cannot absolutely eliminate DNS rebinding, hence the route also requires
  application authentication and has a bounded request budget.
- Bounded HTTPS home-page inspection prefers high-resolution `rel=icon`,
  Apple touch icons and manifest icons, then falls back to `/favicon.ico`.
  Remote HTML/manifest/image reads have strict content/size/time limits;
  SVG and incorrectly typed/invalid image bytes are never served.
- Explicit Cloudflare Cache API provides seven-day positive and twelve-hour
  negative edge TTLs. Cache operations are best-effort, and a small in-isolate
  per-isolate concurrency guard limits parallel crawls to 32. Remote fetch
  promises are not shared across Cloudflare request contexts; the canonical
  same-origin URL, browser image cache and edge Cache API deduplicate by host.
- Cards lazy-load icons with a fixed 40px footprint; native Spectrum
  ListView uses its own Image slot with a 32px asset. Both fall back
  deterministically to the same site monogram and stable host-hash tone.
- The resolver is designed to be safe for user-controlled URLs but does not
  promise to prevent every possible DNS-rebinding attack. Review egress
  controls if exposing the service to untrusted/multi-tenant users.

Security/unit tests stub network fetch and cache (no third-party requests),
and Chromium synthetic-data tests intercept icon paths. A separate real
local-workerd smoke verified icon retrieval from public GitHub/Mozilla
after correcting Cloudflare's unsupported `redirect: "error"` mode:
use `redirect: "manual"` and explicitly reject redirects.

Note: Under future Cloudflare Access enforcement, the Cache API availability
is dependent on Access topology; the resolver safely falls back to uncached
fetches if the edge cache is not available.
