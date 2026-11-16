import { openapi } from "@orpc/openapi";
import { procedure } from "../../base.js";
import { paginationLinks } from "../../linkding/v1/pagination.js";
import { flaredingV1TagPageInput, flaredingV1TagPageOutput } from "./contract.js";

/** Additive Flareding-owned endpoints. No upstream Linkding route is changed. */
export const flaredingV1Routes = {
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
