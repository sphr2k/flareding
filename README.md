# Flareding

Cloudflare-native, linkding-compatible bookmark manager.

**Status:** infrastructure scaffold, not the complete linkding-compatible service.
The public /api/health endpoint exposes no bookmark data. No bookmark CRUD route
will be enabled before API token authentication and linkding HTTP conformance tests.

## Stack

- Cloudflare Worker + SQLite-backed Durable Object, typed native DO RPC.
- Drizzle ORM 1.x, Drizzle Kit migrations, Zod 4 CRUD schemas derived from Drizzle.
- oRPC v2 OpenAPIHandler (linkding-compatible REST contract in upcoming milestone).
- React 19 SPA with **Adobe React Spectrum 2** exclusively. No Tailwind, shadcn, or duplicate UI kit.
- Bun 1.4.3, TypeScript 7 (bun check), Vite+ lint, format, tests.
- Cloudflare Vite plugin v2 and cf CLI with cloudflare.config.ts (no Wrangler).

## Development

Current cf beta requires Node 24.22.1 or newer.

```sh
bun install
bun run typecheck
bun run test
bun run lint
bun run format:check
bun run db:generate  # after schema changes
bun run build
bun run dev
```

The local dev server serves React and a SQLite DO. GET /api/health invokes the DO
through native RPC; initial SQL is applied by the Drizzle durable-sqlite migrator.
Generated migration SQL imports are rewritten to Vite ?raw by
scripts/prepare-migrations.ts to load SQL strings rather than asset URLs.

Use staging mode to isolate the DO namespace: bun run deploy:staging.
Production must wait for authentication, linkding compatibility and backup tests.

## UI design

Adobe **React Spectrum 2** is the sole design system. Use its Provider, accessible
controls, responsive layouts and design tokens. The Vite style macro is built with
unplugin-parcel-macros; Vite+ dep discovery is disabled to avoid interpreting
macro import attributes as normal browser imports.

Bookmark controls are intentionally disabled until the authenticated backend is ready.
No API token is persisted in localStorage.

## Tracking

- Roadmap: https://github.com/sphr2k/flareding/issues/1
- Infrastructure: https://github.com/sphr2k/flareding/issues/2
- UI: https://github.com/sphr2k/flareding/issues/11

The LLM-based tag harmonizer is a separate downstream Worker, with reviewable and
idempotent application of proposed tag changes.
