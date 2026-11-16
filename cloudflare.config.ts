import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
  // Explicit --mode staging; never point a staging deployment at production DOs.
  const staging = mode === "staging" || mode === "staging-access" || mode === "staging-import";
  const enableAccess = staging;
  const enableImport = mode === "staging-import";
  const name = staging ? "flareding-staging" : "flareding";
  return {
    worker: {
      name,
      compatibilityDate: "2026-11-11",
      compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
      entrypoint,
      // Bind the public bookmark URL to the existing staging Worker/SQLite DO.
      domains: staging ? ["bookmarks.janwerner.de"] : [],
      // Existing MCP Service Auth still uses flareding-staging.janwer.workers.dev/mcp.
      workersDev: true,
      previewUrls: true,
      observability: { enabled: true },
      assets: { runWorkerFirst: ["/api/*", "/auth/*", "/mcp"] },
      exports: {
        BookmarkDO: exports.durableObject({ storage: "sqlite" }),
      },
      env: {
        BOOKMARKS: bindings.durableObject({ worker: name, exportName: "BookmarkDO" }),
        API_TOKEN: bindings.secret(),
        // Public Access application metadata. No credential material is embedded here.
        ...(staging
          ? {
              MCP_ACCESS_AUD: bindings.text(
                "cc047918d0a91911fb905709df0dcd5af801a06b23d06e023d5d8a1f5f7fc599",
              ),
              MCP_ACCESS_ISSUER: bindings.text("https://janw.cloudflareaccess.com"),
            }
          : {}),
        // Staging always uses Access for browser login; external APIs retain Token auth.
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
