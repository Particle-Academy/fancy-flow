import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    runtime: "src/runtime/index.ts",
    styles: "src/styles.css",
  },
  format: ["esm", "cjs"],
  dts: { entry: ["src/index.ts", "src/runtime/index.ts"] },
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom", "@xyflow/react"],
  treeshake: true,
});
