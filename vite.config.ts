import macros from "unplugin-parcel-macros";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Adobe Spectrum 2 build-time style macros must run before Vite transforms.
  plugins: [macros.vite(), cloudflare()],
  // Vite dependency scanner does not understand Parcel macro import attributes.
  // Let the macro plugin transform source imports before module resolution.
  resolve: {
    // The v1 use-sync-external-store shim is CommonJS and cannot be imported
    // as browser ESM when dep scanning is disabled for Spectrum's style macro.
    // React 19 exports the same useSyncExternalStore hook natively.
    alias: [{ find: /^use-sync-external-store\/shim(?:\/index\.js)?$/, replacement: "react" }],
  },
  optimizeDeps: {
    noDiscovery: true,
    // Spectrum style macros require disabling discovery, but React's CommonJS
    // JSX runtime must still be prebundled for browser ESM in local cf dev.
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "@tanstack/react-query",
      "use-sync-external-store/shim",
      "react-aria-components",
    ],
  },
  lint: {
    ignorePatterns: ["dist/**", ".cloudflare/**", "drizzle/migrations/**", "node_modules/**"],
    options: { typeAware: false, typeCheck: false },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
