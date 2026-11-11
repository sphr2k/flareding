import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
  // Explicit --mode staging; never point a staging deployment at production DOs.
  const staging = mode === "staging" || mode === "staging-access" || mode === "staging-import";
  const enableAccess = mode === "staging-access";
  const enableImport = mode === "staging-import";
  const name = staging ? "flareding-staging" : "flareding";
  return {
    worker: {
      name,
      compatibilityDate: "2026-11-11",
      compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
      entrypoint,
      observability: { enabled: true },
      assets: { runWorkerFirst: ["/api/*", "/auth/*"] },
      exports: {
        BookmarkDO: exports.durableObject({ storage: "sqlite" }),
      },
      env: {
        BOOKMARKS: bindings.durableObject({ worker: name, exportName: "BookmarkDO" }),
        API_TOKEN: bindings.secret(),
        // Privileged secrets are opt-in and never required for normal releases.
        ...(enableImport ? { IMPORT_SECRET: bindings.secret() } : {}),
        ...(enableAccess
          ? {
              ACCESS_AUD: bindings.secret(),
              ACCESS_TEAM_DOMAIN: bindings.secret(),
              ACCESS_ALLOWED_EMAIL: bindings.secret(),
              SESSION_SECRET: bindings.secret(),
            }
          : {}),
        ASSETS: bindings.assets(),
      },
    },
  };
});
