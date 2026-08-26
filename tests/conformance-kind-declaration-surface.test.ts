/**
 * Parity of SURFACE — the shared table, run against THIS side.
 *
 * Every other conformance table pins what the engine DOES. This one pins what a
 * kind DECLARES, and nothing pinned that until four capabilities had been found
 * present in one runtime and absent in the others: `graph.inputs` dropped on
 * import, `sideEffects` declared by nothing, the conformance Python loader never
 * published, and `outputShape` existing only here. In every one, **absent reads
 * as a legitimate answer**, so nothing reported the gap.
 *
 * This runtime is the SPECIFICATION for the table, not a peer. It ships no
 * executors — a host supplies them — so these declarations are the contract a
 * conforming executor must satisfy, and they are the only ones that cannot be
 * checked against code. PHP, Python and Rust each ship executors and can fall
 * back to reading their own source; here there is nothing to fall back to.
 *
 * Which makes this file the only verification these declarations have.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/kind-declaration-surface/cases.json" with { type: "json" };
import { getNodeKind } from "../src/registry/registry";

type Case = {
  id: string;
  title: string;
  input: { kind: string; config: Record<string, unknown> };
  expected: { outputShape: string[] | string | null; emits: string | null };
};

const cases = (CASES as { cases: Case[] }).cases;

function surfaceOf({ kind: kindId, config }: Case["input"]) {
  const kind = getNodeKind(kindId);
  expect(kind, `builtin \`${kindId}\` is not registered`).not.toBeNull();

  // A config-dependent shape reports the MARKER, never a resolved list: the
  // table asks what the kind DECLARES, and "depends on config" is the
  // declaration. Resolving it here would compare four runtimes' answers to a
  // question each was asked with different config.
  const shape = kind!.outputShape;
  let outputShape: string[] | string | null;
  if (shape === undefined) {
    outputShape = null;
  } else if (typeof shape === "function") {
    outputShape = "dynamic";
  } else {
    // A SET, not an ordered list. These come out of maps, and the Rust twin
    // inserts `count` before `items` where the others do the reverse — so
    // asserting order would report a divergence that is not one.
    outputShape = shape.map((f) => f.path).sort();
  }

  const e = kind!.emits;
  const emits = e === undefined ? null : typeof e === "function" ? e(config as never) : e;

  return { outputShape, emits };
}

describe("flow/kind-declaration-surface", () => {
  it("loads the table — a suite that silently loads nothing reads exactly like a passing one", () => {
    // The vacuity floor, and it is not filler. Every other failure mode here is
    // loud; this one is green.
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, testCase) => {
    expect(surfaceOf(testCase.input), testCase.title).toEqual(testCase.expected);
  });
});
