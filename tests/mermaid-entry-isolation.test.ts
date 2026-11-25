/**
 * `./mermaid` is its own subpath, and stays out of `./engine` and `./connectors`.
 *
 * Asserted on the BUILT artifact, for the reason engine-is-react-free.test.ts
 * gives: a source-level check cannot see chunk splitting. tsup shares modules
 * between entries through chunks, so `/engine` can carry the Mermaid parser
 * without any source file under `src/engine.ts` importing it — one shared
 * helper is enough. Only the emitted import graph says what a consumer gets.
 *
 * The marker is a string the parser cannot work without (its own issue code),
 * so it cannot be tree-shaken out of a bundle that really holds the parser.
 * The positive control proves the walk can see it: a guard that cannot find
 * its subject in the one place it must be would pass everywhere else for free.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const MARKER = "unsupported-diagram";

function walk(entry: string): { files: string[]; externals: Set<string>; text: string } {
  const seen = new Set<string>();
  const externals = new Set<string>();
  const stack = [entry];
  let text = "";
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    text += src;
    for (const m of src.matchAll(/(?:from|import|require\()\s*["']([^"']+)["']/g)) {
      const spec = m[1];
      if (spec.startsWith(".")) {
        const next = resolve(dirname(file), spec);
        for (const candidate of [next, `${next}.js`, `${next}.cjs`]) {
          if (existsSync(candidate)) {
            stack.push(candidate);
            break;
          }
        }
      } else {
        externals.add(spec);
      }
    }
  }
  return { files: [...seen], externals, text };
}

const built = (entry: string) => {
  const path = join(DIST, entry);
  // A missing build is a failure, never a skip.
  expect(existsSync(path), `${entry} is not built — run \`npm run build\` first`).toBe(true);
  return walk(path);
};

describe("the ./mermaid subpath", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  test("is declared in exports with types for import and require", () => {
    expect(pkg.exports["./mermaid"]).toEqual({
      import: { types: "./dist/mermaid/index.d.ts", default: "./dist/mermaid.js" },
      require: { types: "./dist/mermaid/index.d.cts", default: "./dist/mermaid.cjs" },
    });
  });

  test("tsup builds it and its types", () => {
    const config = readFileSync(join(ROOT, "tsup.config.ts"), "utf8");
    expect(config).toMatch(/mermaid:\s*"src\/mermaid\/index\.ts"/);
    const dts = config.slice(config.indexOf("dts:"), config.indexOf("sourcemap"));
    expect(dts).toContain('"src/mermaid/index.ts"');
  });

  test.each(["mermaid.js", "mermaid.cjs"])("%s carries the parser (positive control)", (entry) => {
    expect(built(entry).text).toContain(MARKER);
  });

  test.each(["mermaid.js", "mermaid.cjs"])("%s reaches no React and no React Flow", (entry) => {
    const { externals, text } = built(entry);
    const react = [...externals].filter((e) => e === "react" || e.startsWith("react/") || e === "react-dom");
    expect(react).toEqual([]);
    // @xyflow/react is bundled rather than external, so look for its code.
    expect(text).not.toContain("react-flow__");
  });

  test("the type declarations exist", () => {
    expect(existsSync(join(DIST, "mermaid/index.d.ts"))).toBe(true);
    expect(existsSync(join(DIST, "mermaid/index.d.cts"))).toBe(true);
  });
});

describe("./mermaid stays out of the headless bundles", () => {
  test.each(["engine.js", "engine.cjs", "connectors.js", "connectors.cjs"])("%s does not carry the parser", (entry) => {
    const { files, text } = built(entry);
    // The walk really read something, so "not found" is not vacuous.
    expect(text.length).toBeGreaterThan(1_000);
    expect(text.includes(MARKER), `${entry} reaches the Mermaid parser via ${files.length} module(s)`).toBe(false);
    expect(text).not.toMatch(/fromMermaid|toMermaid/);
  });
});
