import { describe, expect, it } from "vitest";
import { suiteVersion } from "@particle-academy/fancy-conformance";
import CASES from "@particle-academy/fancy-conformance/suites/flow/graph-runs/cases.json" with { type: "json" };
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph } from "../src/types";

registerBuiltinKinds();

/**
 * The shared rows pinning a RAW (non-string) `branch.condition`.
 *
 * `{ kind: "branch", config: { condition: true } }` routed **`false`** here and
 * **`true`** in the PHP, Python and Rust runtimes — the same `WorkflowSchema`
 * taking different routes, which is the one thing the shared suites exist to
 * prevent. Fixed in 0.80.0; these rows are what stop it coming back.
 *
 * ## What is asserted, and why not the whole `outputs` object
 *
 * **Which nodes RAN**, plus `ok`. Both ports are wired to their own `output`
 * node, so the set of nodes that produced output *is* the routing decision:
 * `yes` present and `no` absent can only mean the `true` port fired.
 *
 * The rows' goldens also carry each node's output VALUE, and this file
 * deliberately does not compare those. The suite's reference implementation is
 * PHP, whose branch node emits `{ branch: "true", … }` where this engine emits
 * `{ __port: "true", … }` — so a naive whole-object comparison fails on the
 * shape rather than on the routing. That difference is
 * [fancy-flow#21](https://github.com/Particle-Academy/fancy-flow/issues/21),
 * which covers adopting `flow/graph-runs` wholesale here, and it is a separate
 * piece of work: an existing row (0002) fails such a harness *worse*, by not
 * executing at all.
 *
 * Asserting the part that is genuinely portable today beats asserting nothing
 * until #21 lands, and it beats a `skip` nobody revisits.
 */

const ROWS = CASES.cases.filter((row) => /^00(3[2-6])-/.test(row.id));

/** The nodes that produced output, in a stable order. */
async function ranNodes(row: (typeof CASES.cases)[number]): Promise<string[]> {
  const graph = row.input.schema.graph as {
    nodes: Array<Record<string, unknown>>;
    edges: unknown[];
  };

  const nodes = graph.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: node.position,
    data: { kind: node.kind, config: "config" in node ? node.config : {} },
  }));

  const result = await runFlow({ nodes, edges: graph.edges } as unknown as FlowGraph, {}, undefined, {
    initialInputs: (row.input as { initialInputs?: Record<string, unknown> }).initialInputs,
  });

  expect(result.ok).toBe(true);
  return Object.keys(result.outputs).sort();
}

describe("shared rows: a raw branch.condition routes the same way everywhere", () => {
  it("loads all five rows from the pinned fixture version", () => {
    // A filter that silently matches nothing turns this whole file into a pass.
    console.log(`flow/graph-runs raw branch condition [node] -- fancy-conformance ${suiteVersion()}`);
    expect(suiteVersion()).toBe("0.33.0");
    expect(ROWS).toHaveLength(5);
  });

  for (const row of ROWS) {
    it(`${row.id} — ${row.title}`, async () => {
      // Which port the golden says fired, read from the row rather than
      // restated here: the fixture is the contract, and a second copy of the
      // answer in this file is a copy that can disagree with it.
      const expectedNodes = Object.keys(
        (row.expected as { outputs: Record<string, unknown> }).outputs,
      ).sort();

      expect(await ranNodes(row)).toEqual(expectedNodes);
    });
  }
});
