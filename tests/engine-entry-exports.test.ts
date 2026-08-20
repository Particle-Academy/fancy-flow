/**
 * `/engine` must export every type its own public types REFER to.
 *
 * `NodeKindDefinition.outputShape` is `OutputShape`, which is built from
 * `OutputField`. The root entry exports both; `/engine` exported neither, while
 * the `.d.ts` rollup still DECLARED `OutputField` internally under a mangled
 * name. So the type existed in the shipped artifact and was unreachable by name.
 *
 * That is not hypothetical. Two shipped marketplace nodes already do:
 *
 *   // resources/flow-nodes/stripe-payment-intent/ui/kind.ts
 *   import type { NodeKindDefinition, OutputField } from "@particle-academy/fancy-flow/engine";
 *
 * They typecheck inside the sandbox, where they resolve from SOURCE, and fail
 * against the published package — which is the only place a consumer ever
 * resolves them from. Vendoring one into a real project was broken.
 *
 * Found by Weaver compiling generated packages against the published artifact.
 * Nothing here could have caught it: every test in this repo imports from src.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const source = (p: string) => readFileSync(resolve(root, p), "utf8");

/** Type names re-exported by an entry, however the export is spelled. */
function exportedTypes(entry: string): Set<string> {
  const text = source(entry);
  const names = new Set<string>();
  for (const [, block] of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of block.split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe("the /engine entry", () => {
  const engine = exportedTypes("src/engine.ts");

  // The two the marketplace nodes actually import.
  test.each(["OutputField", "OutputShape"])("exports %s", (name) => {
    expect(engine.has(name)).toBe(true);
  });

  test("exports NodeKindDefinition, which is the premise of the above", () => {
    // If this ever fails the test above is measuring nothing.
    expect(engine.has("NodeKindDefinition")).toBe(true);
  });
});
