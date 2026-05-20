import { defineConfig } from "tsup";

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
});
