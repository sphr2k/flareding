import type { BookmarkDTO } from "./bookmark-contract.js";

/** linkding emits absolute favicon URLs. Keep storage host-independent. */
export function withAbsoluteFavicon(bookmark: BookmarkDTO, requestUrl: string): BookmarkDTO {
  const path = bookmark.favicon_url;
  return {
    ...bookmark,
    favicon_url: path?.startsWith("/api/site-icons/") ? new URL(path, requestUrl).toString() : null,
  };
}
