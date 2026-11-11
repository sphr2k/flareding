import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => {
  // Explicit --mode staging; never point a staging deployment at production DOs.
  const staging = mode === "staging";
  const name = staging ? "flareding-staging" : "flareding";
  return {
    worker: {
      name,
      compatibilityDate: "2026-11-11",
      compatibilityFlags: ["nodejs_compat", "enable_request_signal"],
      entrypoint,
      observability: { enabled: true },
      assets: { runWorkerFirst: ["/api/*"] },
      exports: {
        BookmarkDO: exports.durableObject({ storage: "sqlite" }),
      },
      env: {
        BOOKMARKS: bindings.durableObject({ worker: name, exportName: "BookmarkDO" }),
        ASSETS: bindings.assets(),
      },
    },
  };
});
