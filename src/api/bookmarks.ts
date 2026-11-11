import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  bookmarkCreate,
  bookmarkDto,
  bookmarkPageInput,
  bookmarkPatch,
  tagPageInput,
  pageOutput,
  tagCreate,
  tagDto,
} from "./bookmark-contract.js";
import { procedure } from "./base.js";
import { paginationLinks } from "./pagination.js";
import { withAbsoluteFavicon } from "./favicon-url.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const notFound = (): never => {
  throw new ORPCError("NOT_FOUND", { message: "Not found." });
};
const account = (context: { env: { BOOKMARKS: import("../env.js").Env["BOOKMARKS"] } }) =>
  context.env.BOOKMARKS.getByName("default");

/**
 * External OpenAPIHandler routes, compatible with linkding's REST path style.
 * The Worker checks Authorization: Token for ALL routes in this router.
 */
export const bookmarkRoutes = {
  listBookmarks: procedure
    .meta(openapi({ method: "GET", path: "/bookmarks/" }))
    .input(bookmarkPageInput)
    .output(pageOutput(bookmarkDto))
    .handler(async ({ context, input }) => {
      const result = await account(context).listBookmarks({
        ...input,
        modifiedSince: input.modified_since,
        addedSince: input.added_since,
      });
      return {
        ...result,
        results: result.results.map((bookmark) =>
          withAbsoluteFavicon(bookmark, context.requestUrl),
        ),
        ...paginationLinks(context.requestUrl, result.count, input.limit, input.offset),
      };
    }),

  archivedBookmarks: procedure
    .meta(openapi({ method: "GET", path: "/bookmarks/archived/" }))
    .input(bookmarkPageInput)
    .output(pageOutput(bookmarkDto))
    .handler(async ({ context, input }) => {
      const result = await account(context).listBookmarks({
        ...input,
        archived: true,
        modifiedSince: input.modified_since,
        addedSince: input.added_since,
      });
      return {
        ...result,
        results: result.results.map((bookmark) =>
          withAbsoluteFavicon(bookmark, context.requestUrl),
        ),
        ...paginationLinks(context.requestUrl, result.count, input.limit, input.offset),
      };
    }),

  bookmarkById: procedure
    .meta(openapi({ method: "GET", path: "/bookmarks/{id}/" }))
    .input(idInput)
    .output(bookmarkDto)
    .handler(async ({ context, input }) =>
      withAbsoluteFavicon(
        (await account(context).getBookmark(input.id)) ?? notFound(),
        context.requestUrl,
      ),
    ),

  createBookmark: procedure
    .meta(openapi({ method: "POST", path: "/bookmarks/", successStatus: 201 }))
    .input(bookmarkCreate)
    .output(bookmarkDto)
    .handler(async ({ context, input }) =>
      withAbsoluteFavicon(await account(context).saveBookmark(input), context.requestUrl),
    ),

  patchBookmark: procedure
    .meta(openapi({ method: "PATCH", path: "/bookmarks/{id}/" }))
    .input(z.object({ id: z.coerce.number().int().positive() }).extend(bookmarkPatch.shape))
    .output(bookmarkDto)
    .handler(async ({ context, input }) => {
      const { id, ...patch } = input;
      return withAbsoluteFavicon(
        (await account(context).patchBookmark(id, patch)) ?? notFound(),
        context.requestUrl,
      );
    }),

  putBookmark: procedure
    .meta(openapi({ method: "PUT", path: "/bookmarks/{id}/" }))
    .input(z.object({ id: z.coerce.number().int().positive() }).extend(bookmarkPatch.shape))
    .output(bookmarkDto)
    .handler(async ({ context, input }) => {
      const { id, ...patch } = input;
      if (!patch.url) throw new ORPCError("BAD_REQUEST", { message: "URL is required for PUT" });
      return withAbsoluteFavicon(
        (await account(context).patchBookmark(id, patch)) ?? notFound(),
        context.requestUrl,
      );
    }),

  archiveBookmark: procedure
    .meta(openapi({ method: "POST", path: "/bookmarks/{id}/archive/" }))
    .input(idInput)
    .output(bookmarkDto)
    .handler(async ({ context, input }) =>
      withAbsoluteFavicon(
        (await account(context).setArchived(input.id, true)) ?? notFound(),
        context.requestUrl,
      ),
    ),

  unarchiveBookmark: procedure
    .meta(openapi({ method: "POST", path: "/bookmarks/{id}/unarchive/" }))
    .input(idInput)
    .output(bookmarkDto)
    .handler(async ({ context, input }) =>
      withAbsoluteFavicon(
        (await account(context).setArchived(input.id, false)) ?? notFound(),
        context.requestUrl,
      ),
    ),

  deleteBookmark: procedure
    .meta(openapi({ method: "DELETE", path: "/bookmarks/{id}/", successStatus: 204 }))
    .input(idInput)
    .output(z.void())
    .handler(async ({ context, input }) => {
      if (!(await account(context).deleteBookmark(input.id))) return notFound();
      return undefined;
    }),

  listTags: procedure
    .meta(openapi({ method: "GET", path: "/tags/" }))
    .input(tagPageInput)
    .output(pageOutput(tagDto))
    .handler(async ({ context, input }) => {
      const result = await account(context).listTags(input);
      return {
        ...result,
        ...paginationLinks(context.requestUrl, result.count, input.limit, input.offset),
      };
    }),

  getTag: procedure
    .meta(openapi({ method: "GET", path: "/tags/{id}/" }))
    .input(idInput)
    .output(tagDto)
    .handler(async ({ context, input }) => (await account(context).getTag(input.id)) ?? notFound()),

  createTag: procedure
    .meta(openapi({ method: "POST", path: "/tags/", successStatus: 201 }))
    .input(tagCreate)
    .output(tagDto)
    .handler(async ({ context, input }) => account(context).createTag(input.name)),

  deleteTag: procedure
    .meta(openapi({ method: "DELETE", path: "/tags/{id}/", successStatus: 204 }))
    .input(idInput)
    .output(z.void())
    .handler(async ({ context, input }) => {
      if (!(await account(context).deleteTag(input.id))) return notFound();
      return undefined;
    }),
};
