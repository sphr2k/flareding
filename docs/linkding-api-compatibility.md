# linkding REST compatibility contract

The target is the REST contract of **linkding v1.47.0**, commit
`24b5ad6cc9bde497b5d1b1e86aed5a2fb7d25c2f`, not a client-specific approximation.
GitHub Issue #4 owns API acceptance; #10 owns client acceptance. This document
records the reference and established behavior, not a separate task tracker.

Primary references:

- [API routes](https://github.com/sissbruecker/linkding/blob/v1.47.0/bookmarks/api/routes.py)
- [Serializers](https://github.com/sissbruecker/linkding/blob/v1.47.0/bookmarks/api/serializers.py)
- [Pagination configuration](https://github.com/sissbruecker/linkding/blob/v1.47.0/bookmarks/settings/base.py)
- [Locked dependencies](https://github.com/sissbruecker/linkding/blob/v1.47.0/uv.lock)

Versioned source for this upstream contract: `src/api/linkding/v1/`.
Flareding-specific extensions can live in `src/api/flareding/v1/` and share
the public `/api/` router. The public tag list intentionally filters out
archived-only and unused tags by default. See [API boundaries](api-architecture.md).

## Pagination

The original configures DRF LimitOffsetPagination with default limit 100 and
no `max_limit`. Both bookmark and tag pages accept `limit=1000000`; no
application-specific cap is imposed. Zero, negative and invalid limits fall
back to 100. Negative and invalid offsets fall back to zero. Links to the
first page omit offset instead of emitting `offset=0`.

`tests/fixtures/linkding-pagination.json` is generated using the original
locked DRF 3.17.2 implementation and replayed by the TypeScript contract tests.
Regenerate using the command in `scripts/reference-linkding-pagination.py`.
Runtime tests exercise large limits against a small synthetic dataset, without
allocating a million records or accessing personal data.

## Current compatibility boundary

The REST routes cover bookmark CRUD and archive actions, tags, profiles,
URL checks, bundles and bundle filtering, asset metadata and download,
multipart upload, SingleFile snapshots and opt-in sharing. Bookmark search
supports phrases, tag terms, unread/untagged terms and logical operators.
The API accepts Token and Bearer with the same configured account credential.

Flareding has one account and one static profile. It does not emulate upstream
per-user configuration, automatic tagging or scheduled archive snapshots.
Metadata is fetched on demand, with bounded outbound requests, and asset
uploads are limited to 8 MiB. Focused tests exercise the route contracts against
local workerd and SQLite. Exact upstream validation/error bodies, Unicode
collation and end-to-end behavior across all clients are not established.
