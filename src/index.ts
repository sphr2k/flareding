import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { router } from "./api/health.js";
import type { Env } from "./env.js";
export { BookmarkDO } from "./worker/bookmarks.js";

const handler = new OpenAPIHandler(router);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) {
      const { matched, response } = await handler.handle(request, {
        prefix: "/api",
        context: { env },
      });
      if (matched) return response;
      return Response.json({ detail: "Not found" }, { status: 404 });
    }
    // API is routed through the Worker; Vite-built SPA is served as assets.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
