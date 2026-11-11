import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { router as healthRoutes } from "./api/health.js";
import { bookmarkRoutes } from "./api/bookmarks.js";
import { authenticateToken, authError } from "./api/auth.js";
import { handleSession, hasBrowserSession, isSameOriginMutation } from "./api/session.js";
import type { Env } from "./env.js";
import { accessMode, accessReady, handleAccessSession } from "./api/access.js";
import { handlePinboardAdmin, isImportAdminPath } from "./import/admin-api.js";
import { handleSiteIcon } from "./worker/site-icons.js";
export { BookmarkDO } from "./worker/bookmarks.js";

const handler = new OpenAPIHandler(
  { ...healthRoutes, ...bookmarkRoutes },
  {
    // Existing linkding clients expect a simple {"detail": "..."} JSON error.
    errorResponseBodyEncoder: (error) => ({
      detail: error.code === "INTERNAL_SERVER_ERROR" ? "Internal server error." : error.message,
    }),
  },
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    // Must remain outside Access-bypassed /api/*.
    if (path === "/auth/access/session") return handleAccessSession(request, env);
    if (path.startsWith("/api/")) {
      if (isImportAdminPath(path)) return handlePinboardAdmin(request, env);
      if (path === "/api/session/") {
        return handleSession(request, env.API_TOKEN, {
          accessMode: accessMode(env),
          sessionSecret: accessReady(env) ? env.SESSION_SECRET : undefined,
        });
      }
      if (path !== "/api/health") {
        // External integrations use the original linkding token header.
        // The web UI instead receives a short-lived, HttpOnly signed session.
        if (request.headers.has("Authorization")) {
          const auth = await authenticateToken(request, env.API_TOKEN);
          if (auth !== "ok") return authError(auth);
        } else if (
          await hasBrowserSession(
            request,
            accessMode(env) ? (accessReady(env) ? env.SESSION_SECRET : undefined) : env.API_TOKEN,
          )
        ) {
          // SameSite=Strict + explicit Origin validation for cookie-auth mutations.
          if (!isSameOriginMutation(request))
            return Response.json({ detail: "Forbidden." }, { status: 403 });
        } else {
          const auth = await authenticateToken(request, env.API_TOKEN);
          return authError(auth === "unavailable" ? "unavailable" : "invalid");
        }
      }
      if (path.startsWith("/api/site-icons/")) {
        // Session/token authorization above applies before any DNS or fetch.
        return handleSiteIcon(request, { waitUntil: (promise) => ctx.waitUntil(promise) });
      }
      const { matched, response } = await handler.handle(request, {
        prefix: "/api",
        context: { env, requestUrl: request.url },
      });
      if (matched) {
        // Prevent intermediaries from caching authenticated personal data.
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "private, no-store");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return Response.json({ detail: "Not found" }, { status: 404 });
    }
    // API is routed through the Worker; Vite-built SPA is served as assets.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
