/**
 * `/engine` must reach no React, and a host's own kinds must not care.
 *
 * ## Why this asserts on the BUILT artifact
 *
 * Because a source-level check does not work, and believing it does is how
 * this got missed. `rich-input.tsx` has only a *type* import from react — a
 * grep for `from "react"` calls it clean — and the JSX transform injects
 * `react/jsx-runtime` at build. Only the emitted output tells the truth.
 *
 * ## Why it exists at all
 *
 * `/engine` promised "zero React" and pulled a 444 KB chunk carrying react,
 * react-dom and jsx-runtime (#11). It was a REGRESSION: `engine.ts` imports
 * from `./registry/registry` rather than the barrel precisely to avoid this —
 * its comment records the original failure, a marketplace package's fixtures
 * dying on a clean install with "Cannot find package 'react'" — and
 * `registry.ts` later gained a `builtin.ts` import so the registry
 * self-populates, which fixed an equally real bug.
 *
 * Two correct fixes collided. **Nothing tested the property**, so the second
 * silently undid the first, and it would have come back a third time.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

/** Every module a built entry reaches, and every bare specifier it imports. */
function walk(entry: string): { files: string[]; externals: Set<string>; bytes: number } {
  const seen = new Set<string>();
  const externals = new Set<string>();
  const stack = [entry];
  let bytes = 0;

  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    const src = readFileSync(file, "utf8");
    bytes += src.length;
    const specs = [...src.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);

    for (const spec of specs) {
      if (spec.startsWith(".")) {
        const next = resolve(dirname(file), spec);
        // Built output carries explicit extensions; try the bare path too.
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

  return { files: [...seen], externals, bytes };
}

const ENTRIES = ["engine.js", "engine.cjs"];

describe("/engine is React-free", () => {
  test.each(ENTRIES)("%s reaches no react import", (entry) => {
    const path = join(DIST, entry);

    // A missing build is a FAILURE, never a skip. A guard that quietly passes
    // when it cannot see its subject is the thing it was written to prevent.
    expect(existsSync(path), `${entry} is not built — run \`npm run build\` first`).toBe(true);

    const { files, externals, bytes } = walk(path);

    // The walk really did read the bundle — otherwise "no react" is vacuous.
    //
    // Measured in BYTES rather than file count: the ESM build splits into
    // chunks and the CJS build inlines into one file, so a file-count
    // threshold passes for one and fails for the other while proving nothing
    // about either.
    expect(bytes).toBeGreaterThan(10_000);
    expect(externals.size).toBeGreaterThan(0);

    const react = [...externals].filter((e) => e === "react" || e.startsWith("react/") || e === "react-dom");

    expect(react, [
      `${entry} reaches React through its import graph.`,
      "",
      `  via: ${files.length} module(s), ${bytes} bytes, externals: ${[...externals].sort().join(", ")}`,
      "",
      "`/engine` is the headless entry — a queue worker, a CLI, a marketplace",
      "package's CI. Something it imports now pulls a React module. The usual",
      "cause is a module reachable from `registry/registry.ts` importing a",
      "`.tsx` component; keep those behind `registry/builtin.ts`, which only the",
      "React root barrel loads.",
    ].join("\n")).toEqual([]);
  });
});

describe("the split is invisible to a host's own kinds", () => {
  test("a host kind registered at startup resolves, with no builtin import", async () => {
    // Genie's suggested guard, in their words: "a host kind registered at
    // startup is resolvable, with the builtin import absent."
    //
    // The concern is real and specific: if `registerNodeKind` writes into the
    // registry that self-population fills, then changing WHEN that import runs
    // must not change WHETHER the registry exists — only what is in it. Their
    // failure mode would be silent — an empty palette, not an error.
    //
    // This imports the REGISTRY ONLY, never the package root, so nothing here
    // fires the root barrel's registration.
    const { registerNodeKind, getNodeKind, listNodeKinds } = await import("../src/registry/registry");

    registerNodeKind({
      name: "@acme/host-step",
      category: "custom",
      label: "Host Step",
      inputs: [{ id: "in" }],
      outputs: [{ id: "out" }],
    });

    expect(getNodeKind("@acme/host-step")?.label).toBe("Host Step");
    // And the builtins came along, so the host did not get a registry holding
    // only its own kind.
    expect(getNodeKind("@particle-academy/branch")).toBeTruthy();
    expect(listNodeKinds().length).toBeGreaterThan(20);
  });

  test("the builtins a headless consumer gets carry no renderer", async () => {
    // The other half of the same property. `/engine` hands over the full
    // vocabulary — schema, ports, executors — and no components, which is the
    // correct answer for a runtime with no DOM.
    const { BUILTIN_KIND_DATA } = await import("../src/registry/builtin-kinds");

    const withRenderers = BUILTIN_KIND_DATA.filter((k) => k.component || k.renderBody);

    expect(withRenderers.map((k) => k.name)).toEqual([]);
    // …and the table is genuinely the whole kit, not an empty list.
    expect(BUILTIN_KIND_DATA.length).toBeGreaterThan(25);
  });
});
