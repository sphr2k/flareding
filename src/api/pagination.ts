export function paginationLinks(
  url: string,
  count: number,
  limit: number,
  offset: number,
): { next: string | null; previous: string | null } {
  const page = (newOffset: number) => {
    const next = new URL(url);
    next.searchParams.set("limit", String(limit));
    next.searchParams.set("offset", String(newOffset));
    return next.toString();
  };
  return {
    next: offset + limit < count ? page(offset + limit) : null,
    previous: offset > 0 ? page(Math.max(0, offset - limit)) : null,
  };
}
