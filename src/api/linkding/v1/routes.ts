import { openapi } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import { z } from "zod";
import {
  bookmarkCreate,
  bundleCreate,
  bundlePatch,
  pageInput,
  bookmarkDto,
  bookmarkPageInput,
  bookmarkPatch,
  tagPageInput,
  tagPageOutput,
  pageOutput,
  tagCreate,
  tagDto,
} from "./contract.js";
import { loadWebsiteMetadata } from "../../../worker/site-icons.js";
import { procedure } from "../../base.js";
import { paginationLinks } from "./pagination.js";
import { withAbsoluteFavicon } from "./favicon-url.js";

const idInput = z.object({ id: z.coerce.number().int().positive() });
const notFound = (): never => {
  throw new ORPCError("NOT_FOUND", { message: "Not found." });
};
const duplicateUrl = (): never => {
  throw new ORPCError("CONFLICT", { message: "A bookmark with this URL already exists." });
};
const account = (context: { env: { BOOKMARKS: import("../../../env.js").Env["BOOKMARKS"] } }) =>
  context.env.BOOKMARKS.getByName("default");

/**
 * External OpenAPIHandler routes, compatible with linkding's REST path style.
 * The Worker checks Authorization: Token for ALL routes in this router.
 */
export const linkdingV1Routes = {
  apiRoot: procedure.meta(openapi({ method: "GET", path: "/" })).handler(() => ({})),

  userProfile: procedure
    .meta(openapi({ method: "GET", path: "/user/profile/" }))
    .handler(({ context }) => ({
      theme: "auto",
      bookmark_date_display: "relative",
      bookmark_link_target: "_blank",
      web_archive_integration: "disabled",
      tag_search: "strict",
      enable_sharing: Boolean(context.env.LINKDING_SHARE_USERNAME),
      enable_public_sharing:
        Boolean(context.env.LINKDING_SHARE_USERNAME) &&
        context.env.LINKDING_PUBLIC_SHARING === "true",
      enable_favicons: true,
      display_url: false,
      permanent_notes: false,
      search_preferences: {},
      // Do not advertise a linkding release whose full API we do not implement.
      version: "0.0.0",
    })),

  listBookmarks: procedure
    .meta(openapi({ method: "GET", path: "/bookmarks/" }))
    .input(bookmarkPageInput)
    .output(pageOutput(bookmarkDto))
    .handler(async ({ context, input }) => {
      const result = await account(context).listBookmarks({
        ...input,
        linkdingSearch: true,
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
        linkdingSearch: true,
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

  sharedBookmarks: procedure
    .meta(openapi({ method: "GET", path: "/bookmarks/shared/" }))
    .input(bookmarkPageInput.extend({ user: z.string().optional() }))
    .output(pageOutput(bookmarkDto))
    .handler(async ({ context, input }) => {
      // Single-account service: sharing stays disabled until an owner is explicitly configured.
      if (
        !context.env.LINKDING_SHARE_USERNAME ||
        input.user !== context.env.LINKDING_SHARE_USERNAME
      ) {
        return { count: 0, results: [], next: null, previous: null };
      }
      const page = await account(context).listBookmarks({
        ...input,
        shared: true,
        sharedCollection: true,
        linkdingSearch: true,
        modifiedSince: input.modified_since,
        addedSince: input.added_since,
      });
      return {
        ...page,
        results: page.results.map((bookmark) => withAbsoluteFavicon(bookmark, context.requestUrl)),
        ...paginationLinks(context.requestUrl, page.count, input.limit, input.offset),
      };
    }),

  checkBookmark: procedure
    .meta(openapi({ method: "GET", path: "/bookmarks/check/" }))
    .input(z.object({ url: bookmarkCreate.shape.url, ignore_cache: z.string().optional() }))
    .handler(async ({ context, input }) => {
      const [existing, metadata] = await Promise.all([
        account(context).getBookmarkByUrl(input.url),
        loadWebsiteMetadata(input.url, input.ignore_cache === "true"),
      ]);
      return {
        bookmark: existing ? withAbsoluteFavicon(existing, context.requestUrl) : null,
        metadata,
        auto_tags: [],
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
    .handler(async ({ context, input }) => {
      const query = new URL(context.requestUrl).searchParams;
      if (!query.has("disable_scraping") && (!input.title || !input.description)) {
        const metadata = await loadWebsiteMetadata(input.url);
        input = {
          ...input,
          title: input.title || metadata.title || input.title,
          description: input.description || metadata.description || input.description,
        };
      }
      return withAbsoluteFavicon(await account(context).saveBookmark(input), context.requestUrl);
    }),

  patchBookmark: procedure
    .meta(openapi({ method: "PATCH", path: "/bookmarks/{id}/" }))
    .input(z.object({ id: z.coerce.number().int().positive() }).extend(bookmarkPatch.shape))
    .output(bookmarkDto)
    .handler(async ({ context, input }) => {
      const { id, ...patch } = input;
      const bookmark = (await account(context).patchBookmark(id, patch)) ?? notFound();
      if ("conflict" in bookmark) return duplicateUrl();
      return withAbsoluteFavicon(bookmark, context.requestUrl);
    }),

  putBookmark: procedure
    .meta(openapi({ method: "PUT", path: "/bookmarks/{id}/" }))
    .input(z.object({ id: z.coerce.number().int().positive() }).extend(bookmarkPatch.shape))
    .output(bookmarkDto)
    .handler(async ({ context, input }) => {
      const { id, ...patch } = input;
      if (!patch.url) throw new ORPCError("BAD_REQUEST", { message: "URL is required for PUT" });
      const bookmark = (await account(context).patchBookmark(id, patch)) ?? notFound();
      if ("conflict" in bookmark) return duplicateUrl();
      return withAbsoluteFavicon(bookmark, context.requestUrl);
    }),

  archiveBookmark: procedure
    .meta(openapi({ method: "POST", path: "/bookmarks/{id}/archive/", successStatus: 204 }))
    .input(idInput)
    .output(z.void())
    .handler(async ({ context, input }) => {
      if (!(await account(context).setArchived(input.id, true))) return notFound();
    }),

  unarchiveBookmark: procedure
    .meta(openapi({ method: "POST", path: "/bookmarks/{id}/unarchive/", successStatus: 204 }))
    .input(idInput)
    .output(z.void())
    .handler(async ({ context, input }) => {
      if (!(await account(context).setArchived(input.id, false))) return notFound();
    }),

  deleteBookmark: procedure
    .meta(openapi({ method: "DELETE", path: "/bookmarks/{id}/", successStatus: 204 }))
    .input(idInput)
    .output(z.void())
    .handler(async ({ context, input }) => {
      if (!(await account(context).deleteBookmark(input.id))) return notFound();
      return undefined;
    }),

  listBundles: procedure
    .meta(openapi({ method: "GET", path: "/bundles/" }))
    .input(pageInput)
    .handler(async ({ context, input }) => {
      const page = await account(context).listBundles(input.limit, input.offset);
      return {
        ...page,
        ...paginationLinks(context.requestUrl, page.count, input.limit, input.offset),
      };
    }),

  getBundle: procedure
    .meta(openapi({ method: "GET", path: "/bundles/{id}/" }))
    .input(idInput)
    .handler(
      async ({ context, input }) => (await account(context).getBundle(input.id)) ?? notFound(),
    ),

  createBundle: procedure
    .meta(openapi({ method: "POST", path: "/bundles/", successStatus: 201 }))
    .input(bundleCreate)
    .handler(({ context, input }) => account(context).createBundle(input)),

  updateBundle: procedure
    .meta(openapi({ method: "PATCH", path: "/bundles/{id}/" }))
    .input(idInput.extend(bundlePatch.shape))
    .handler(
      async ({ context, input: { id, ...input } }) =>
        (await account(context).updateBundle(id, input)) ?? notFound(),
    ),

  replaceBundle: procedure
    .meta(openapi({ method: "PUT", path: "/bundles/{id}/" }))
    .input(idInput.extend(bundleCreate.shape))
    .handler(
      async ({ context, input: { id, ...input } }) =>
        (await account(context).updateBundle(id, input)) ?? notFound(),
    ),

  deleteBundle: procedure
    .meta(openapi({ method: "DELETE", path: "/bundles/{id}/", successStatus: 204 }))
    .input(idInput)
    .output(z.void())
    .handler(async ({ context, input }) => {
      if (!(await account(context).deleteBundle(input.id))) return notFound();
    }),

  listTags: procedure
    .meta(openapi({ method: "GET", path: "/tags/" }))
    .input(tagPageInput)
    .output(tagPageOutput)
    .handler(async ({ context, input }) => {
      const result = await account(context).listTags({
        ...input,
        includeArchived: input.include_archived,
        includeUnused: input.include_unused,
      });
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
