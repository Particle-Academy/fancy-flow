import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Rules of Hooks — the one lint this package cannot do without.
 *
 * A hook called conditionally, in a loop, in a callback, or from a plain
 * function desyncs React's hook order and throws from inside React, naming none
 * of the responsible code. The page unmounts. Typechecking cannot see it, and
 * tests miss it unless they cross the exact transition that flips the hook
 * count, so nothing else in this repo catches this class of bug.
 *
 * Deliberately narrow:
 *
 * - `exhaustive-deps` is OFF. It is worth turning on, but it fires in the
 *   hundreds across this suite and would bury real errors in warnings on day
 *   one. That is its own pass.
 * - Unused `eslint-disable` directives are not reported. The suite carries ~32
 *   `eslint-disable-next-line react-hooks/exhaustive-deps` comments written when
 *   this repo had no ESLint at all, so they suppress a rule that never ran.
 *   Reporting them would make linting fail the moment it started existing.
 */
export default [
  // MUST be its own object with no `files` key. An `ignores` alongside `files`
  // only filters THAT config block — it does not stop ESLint walking the
  // directory. Written the wrong way, this linted `dist/`, and minified bundles
  // reported hook "violations" inside React's own compiled internals.
  {
    ignores: ["**/dist/**", "**/build/**", "**/coverage/**", "**/node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module", ecmaVersion: "latest" },
    },
    // Registered so `@typescript-eslint/*` disable comments already in the
    // source resolve to a real definition. No rules from it are switched on.
    plugins: { "react-hooks": reactHooks, "@typescript-eslint": tseslint.plugin },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
];
