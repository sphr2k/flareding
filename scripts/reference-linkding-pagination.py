"""Generate synthetic reference fixtures using linkding v1.47.0's locked DRF.

Run: uv run --no-project --with djangorestframework==3.17.2 python \
    scripts/reference-linkding-pagination.py > tests/fixtures/linkding-pagination.json
"""
import json
from types import SimpleNamespace
from django.conf import settings

settings.configure(REST_FRAMEWORK={"PAGE_SIZE": 100}, SECRET_KEY="synthetic-reference-only")
from django.http import QueryDict
from rest_framework.pagination import LimitOffsetPagination

cases = []
for query in ["", "limit=1000", "limit=1000000", "limit=0", "limit=-1",
              "limit=invalid", "limit=1.5", "offset=-1", "offset=invalid",
              "limit=10&offset=10", "limit=10&offset=20", "limit=10&offset=100"]:
    url = "https://reference.example/api/tags/" + ("?" + query if query else "")
    request = SimpleNamespace(query_params=QueryDict(query), build_absolute_uri=lambda u=url: u)
    paginator = LimitOffsetPagination()
    paginator.limit = paginator.get_limit(request)
    paginator.offset = paginator.get_offset(request)
    paginator.request = request
    paginator.count = 35
    cases.append({"query": query, "limit": paginator.limit, "offset": paginator.offset,
                  "next": paginator.get_next_link(), "previous": paginator.get_previous_link()})
print(json.dumps({"upstream": "linkding v1.47.0",
                  "commit": "24b5ad6cc9bde497b5d1b1e86aed5a2fb7d25c2f",
                  "pagination": "djangorestframework 3.17.2 LimitOffsetPagination",
                  "count": 35, "cases": cases}, indent=2))
