/**
 * An entry that registers something at import time must be declared
 * side-effectful, or a bundler is entitled to delete the registration.
 *
 * `src/index.ts` calls `registerBuiltinKinds()` as a bare top-level statement —
 * that call IS the mechanism by which all 27 builtin kinds exist. `package.json`
 * declared `sideEffects: ["**\/*.css"]`, which tells Rollup every JS module is
 * pure, so a consumer writing
 *
 *     import { FlowViewer } from "@particle-academy/fancy-flow";
 *
 * kept `FlowViewer` and had the registration shaken out as dead code.
 * `getNodeKind()` then returned null for every builtin and `FlowViewer` fell
 * through its title chain to `node.data.kind`, printing the raw
 * `@particle-academy/llm_call` on the card. Custom kinds were unaffected —
 * consumers register those at runtime, after bundling.
 *
 * Measured through a real Vite build at the time of the fix: 0 kinds bundled
 * vs 27 in Node. Nothing in this suite could see it, because vitest EVALUATES
 * the module rather than bundling it — every existing test passed throughout.
 * So this test asserts on the manifest, which is the thing that was wrong.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

/** Entry name → source file, read from tsup's config so the two cannot drift. */
function entries(): Record<string, string> {
  const config = readFileSync(resolve(root, "tsup.config.ts"), "utf8");
  const block = config.slice(config.indexOf("entry: {"), config.indexOf("format:"));
  const found: Record<string, string> = {};
  for (const [, name, file] of block.matchAll(/["']?([\w/-]+)["']?:\s*["']([^"']+)["']/g)) {
    if (file.endsWith(".css")) continue;
    found[name] = file;
  }
  return found;
}

/** A bare top-level call — `foo();` at column 0 — is an import-time side effect. */
function hasTopLevelCall(source: string): boolean {
  return /^[A-Za-z_$][\w$]*\(\s*\);/m.test(source);
}

describe("sideEffects covers every entry that registers at import time", () => {
  const declared: string[] = pkg.sideEffects ?? [];

  const impure = Object.entries(entries()).filter(([, file]) =>
    hasTopLevelCall(readFileSync(resolve(root, file), "utf8")),
  );

  test("the root entry is still the one that registers the builtins", () => {
    // Guards the premise: if this moves, the assertion below is testing nothing.
    expect(impure.map(([name]) => name)).toContain("index");
  });

  test.each(impure)("dist/%s is declared side-effectful", (name) => {
    for (const ext of ["js", "cjs"]) {
      expect(declared).toContain(`./dist/${name}.${ext}`);
    }
  });
});
