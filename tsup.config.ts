import { fileURLToPath } from "node:url";
import type { Plugin } from "esbuild";
import { defineConfig } from "tsup";

const withSelectorShim = fileURLToPath(
  new URL("./src/shims/use-sync-external-store-with-selector.ts", import.meta.url),
);

/**
 * Because we bundle @xyflow/react (below), its transitive zustand pulls in
 * the CJS-only `use-sync-external-store/shim/with-selector`. esbuild bundles
 * that CJS module but leaves its internal `require("react")` intact in ESM
 * output (react is external), which throws "Calling require for react" in a
 * browser ESM consumer. Redirect that import to our ESM polyfill, which uses
 * React 18+'s native useSyncExternalStore (our peer range is ^18 || ^19).
 */
const shimUseSyncExternalStore: Plugin = {
  name: "shim-use-sync-external-store-with-selector",
  setup(build) {
    build.onResolve({ filter: /use-sync-external-store\/shim\/with-selector(\.js)?$/ }, () => ({
      path: withSelectorShim,
    }));
  },
};

/**
 * Bundle @xyflow/react into our dist so consumers don't have to install it
 * separately and they never see its types unless they reach for our deep
 * import. `react` and `react-dom` stay external as peer deps so React's
 * single-instance invariant holds.
 *
 * Tradeoff: if a consumer also has @xyflow/react elsewhere in their bundle
 * they'll carry two copies. Documented in the README's "Why two copies?"
 * callout. The wrapper around `Handle` / `Position` (`<NodePort>` +
 * `defineNode`) means consumers virtually never need their own copy.
 */
export default defineConfig({
  entry: {
    index: "src/index.ts",
    runtime: "src/runtime/index.ts",
    registry: "src/registry/index.ts",
    schema: "src/schema/index.ts",
    styles: "src/styles.css",
  },
  format: ["esm", "cjs"],
  dts: { entry: ["src/index.ts", "src/runtime/index.ts", "src/registry/index.ts", "src/schema/index.ts"] },
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  noExternal: ["@xyflow/react", "@xyflow/system", "clsx"],
  treeshake: true,
  esbuildPlugins: [shimUseSyncExternalStore],
});
