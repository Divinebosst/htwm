"""Small helpers shared by the staff API."""

import math

from rest_framework.response import Response


def paginate(request, queryset, serializer_class, extra=None, context=None, default_size=50):
    try:
        size = max(1, min(int(request.query_params.get("page_size", default_size)), 200))
    except ValueError:
        size = default_size
    count = queryset.count()
    pages = max(1, math.ceil(count / size))
    try:
        page = max(1, min(int(request.query_params.get("page", 1)), pages))
    except ValueError:
        page = 1
    items = queryset[(page - 1) * size : page * size]
    data = {
        "count": count,
        "page": page,
        "pages": pages,
        "page_size": size,
        "results": serializer_class(items, many=True, context=context or {"request": request}).data,
    }
    if extra:
        data.update(extra)
    return Response(data)
