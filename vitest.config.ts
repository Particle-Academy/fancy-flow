import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    /**
     * `.tsx` is included deliberately.
     *
     * This pattern was `.test.ts` only, so not one of the package's 21 React
     * components could have a rendering test — every suite here is pure logic,
     * and a file testing a component would have been collected by nothing and
     * counted as passing by omission. That is how the config panel shipped with
     * zero `htmlFor`, zero control ids and zero `aria-label`s: nothing in the
     * repo could see rendered output.
     *
     * Per-file `@vitest-environment jsdom` opts the DOM suites in, so the logic
     * suites keep the faster node environment.
     */
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
