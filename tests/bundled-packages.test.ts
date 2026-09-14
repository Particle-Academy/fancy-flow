import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tsupConfig from "../tsup.config";

/**
 * Everything tsup is told to bundle (`noExternal`) must be something the source
 * actually reaches.
 *
 * Bundling is how third-party code gets INTO this package's dist and so into
 * every consumer, which is why each entry has to be a dependency the suite has
 * approved and is keeping current. An entry nothing reaches is a dependency
 * held for no reason: it still has to be installed, still has to pass the
 * third-party allowlist, and still reads to the next person as "fancy-flow ships
 * this".
 *
 * `clsx` was exactly that. It was listed here, and as a devDependency to
 * satisfy the listing, from 0.3.0 onward, and no file in `src/` ever imported it
 * — @xyflow/react, the thing being bundled, uses `classcat`. When clsx failed
 * the freshness bar there was nothing to replace, only a line to delete.
 *
 * The list comes from the real tsup config, not a copy of it.
 */

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Package names `src/` imports at runtime. `import type` is erased and does not count. */
function runtimeImports(): Set<string> {
  const names = new Set<string>();
  const statics = /^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/gm;
  const dynamics = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

  for (const file of sourceFiles(join(root, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const match of [...text.matchAll(statics), ...text.matchAll(dynamics)]) {
      const specifier = match[1]!;
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      const parts = specifier.split("/");
      names.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!);
    }
  }
  return names;
}

const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
const bundled = configs.flatMap((config) =>
  ((config as { noExternal?: Array<string | RegExp> }).noExternal ?? []).filter(
    (entry): entry is string => typeof entry === "string",
  ),
);

/**
 * A bundled package is reached when `src/` imports it, or when a bundled package
 * that is reached depends on it (so bundling the first pulls the second in).
 */
function reachedBundledPackages(): { direct: Set<string>; reached: Set<string> } {
  const imports = runtimeImports();
  const direct = new Set(bundled.filter((name) => imports.has(name)));
  const reached = new Set(direct);
  const queue = [...direct];

  while (queue.length > 0) {
    const name = queue.shift()!;
    const manifest = JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (bundled.includes(dep) && !reached.has(dep)) {
        reached.add(dep);
        queue.push(dep);
      }
    }
  }
  return { direct, reached };
}

describe("bundled third-party packages", () => {
  const { direct, reached } = reachedBundledPackages();

  it("reads the config and the source the way the build does (controls)", () => {
    // Known positives, one per route: without these, a config that failed to
    // load or a scanner that matched nothing would pass the check below
    // vacuously, or fail it for the wrong reason.
    expect(bundled.length).toBeGreaterThan(0);
    expect(direct.has("@xyflow/react")).toBe(true);
    expect(direct.has("@dagrejs/dagre")).toBe(true);
    // Reached only through @xyflow/react's own dependencies.
    expect(direct.has("@xyflow/system")).toBe(false);
    expect(reached.has("@xyflow/system")).toBe(true);
    // Known negative: src/live.ts imports fancy-query with `import type`.
    expect(runtimeImports().has("@particle-academy/fancy-query")).toBe(false);
  });

  it("are all reached by the source", () => {
    for (const name of bundled) {
      expect(reached.has(name), `tsup bundles "${name}", but nothing in src/ reaches it`).toBe(true);
    }
  });
});
