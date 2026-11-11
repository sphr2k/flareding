import macros from "unplugin-parcel-macros";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // Adobe Spectrum 2 build-time style macros must run before Vite transforms.
  plugins: [macros.vite(), cloudflare()],
  // Vite dependency scanner does not understand Parcel macro import attributes.
  // Let the macro plugin transform source imports before module resolution.
  optimizeDeps: { noDiscovery: true },
  lint: {
    ignorePatterns: ["dist/**", ".cloudflare/**", "drizzle/migrations/**", "node_modules/**"],
    options: { typeAware: false, typeCheck: false },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
