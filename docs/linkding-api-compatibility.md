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

Full compatibility has **not** yet been established. The source comparison
identifies material differences beyond pagination: upstream archive actions
return 204; upstream serializers include legacy website metadata fields;
authentication accepts both Token and Bearer; shared collections, URL metadata
checking, bundles, user profile and bookmark asset routes exist upstream; search
supports more than the current text search plus `!unread` handling. Error and
validation semantics also require conformance coverage. Those differences must
be resolved and tested before describing this API as 100% compatible.
