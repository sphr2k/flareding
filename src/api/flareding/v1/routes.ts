import { openapi } from "@orpc/openapi";
import { procedure } from "../../base.js";
import { paginationLinks } from "../../linkding/v1/pagination.js";
import { withAbsoluteFavicon } from "../../linkding/v1/favicon-url.js";
import {
  flaredingV1TagPageInput,
  flaredingV1TagPageOutput,
  flaredingV1BookmarkSearchInput,
  flaredingV1BookmarkSearchOutput,
} from "./contract.js";

/** Additive Flareding-owned endpoints. No upstream Linkding route is changed. */
export const flaredingV1Routes = {
  searchBookmarks: procedure
    .meta(openapi({ method: "POST", path: "/flareding/v1/bookmarks/search/" }))
    .input(flaredingV1BookmarkSearchInput)
    .output(flaredingV1BookmarkSearchOutput)
    .handler(async ({ context, input }) => {
      const result = await context.env.BOOKMARKS.getByName("default").listBookmarks({
        limit: input.limit,
        offset: input.offset,
        q: input.query,
        tagsAll: [...new Set(input.tags)],
        archived: input.view === "archived",
        unread: input.view === "unread",
      });
      return {
        ...result,
        results: result.results.map((bookmark) =>
          withAbsoluteFavicon(bookmark, context.requestUrl),
        ),
        ...paginationLinks(context.requestUrl, result.count, input.limit, input.offset),
      };
    }),

  listTags: procedure
    .meta(openapi({ method: "GET", path: "/flareding/v1/tags/" }))
    .input(flaredingV1TagPageInput)
    .output(flaredingV1TagPageOutput)
    .handler(async ({ context, input }) => {
      const result = await context.env.BOOKMARKS.getByName("default").listFlaredingV1Tags({
        limit: input.limit,
        offset: input.offset,
        q: input.q,
        includeArchived: input.include_archived,
      });
      return {
        ...result,
        ...paginationLinks(context.requestUrl, result.count, input.limit, input.offset),
      };
    }),
};
