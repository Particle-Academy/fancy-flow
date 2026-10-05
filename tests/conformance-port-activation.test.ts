/**
 * Which output ports a node lights, and what each one carries — the shared
 * table, run against THIS side.
 *
 * The engine knew two answers until fancy-flow-php#18: `__port` / `branch` lit
 * exactly one port, and anything else lit EVERY declared port. A router that
 * matched two of five lanes had to drop the rest of the work or wake lanes
 * nobody asked for. `__ports` is the third answer, and this table is what keeps
 * all four runtimes giving it identically.
 *
 * The rows assert the `node-output` EVENTS, not `activatedPorts`' return value.
 * That function is private in every runtime, and the events are what a consumer
 * — and the durable layer, which reads activated ports straight off them —
 * actually observes. Asserting the private function would also let this file
 * pass while the events it feeds were wrong.
 *
 * ROW 0303 WAS SKIPPED HERE, AND IT IS THE INTERESTING ONE. A node whose
 * `outputs` are an explicitly empty list publishes nothing in PHP, Python and
 * Rust; this engine published `out`, because the fallback tested
 * `declared?.length` and `[]` is falsy — so the three states the other runtimes
 * keep (undeclared / explicitly none / declared) were two here.
 *
 * **Fixed in 0.76.0** (`declared ?? ["out"]`), the fixture's skip was dropped,
 * and the row now RUNS AND PASSES. Measured 2026-10-05, not inferred from the
 * diff.
 *
 * This paragraph is kept rather than deleted because the skip did its job
 * exactly as designed: it carried the reason, printed on every run, and started
 * passing the day the fallback was fixed. That is what a skip is for, and it is
 * worth one paragraph to say so — a reader who meets a skipped conformance row
 * should know the pattern ends this way.
 *
 * It is rewritten rather than left alone because it had gone STALE: it still
 * said "is skipped" and "this engine publishes `out`" four minor versions after
 * neither was true, which told anyone reading it that a fixed bug was live.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/port-activation/cases.json" with { type: "json" };
import { runFlow } from "../src/runtime/run-flow";
import type { RunEvent } from "../src/types";

type Lit = { port: string; value: unknown };

type Case = {
  id: string;
  title: string;
  expected: Lit[];
  skip?: Record<string, string>;
  input: { declaredOutputs: string[] | null; result: unknown };
};

const cases = (CASES as { cases: Case[] }).cases;

describe("flow/port-activation", () => {
  // The vacuity guard. One row expects NO ports at all and several expect two,
  // so a table that failed to load — or loaded empty — must not read as green.
  it("loaded the shared table", () => {
    expect(cases.length).toBeGreaterThan(10);
    expect(cases.some((c) => c.expected.length === 0)).toBe(true);
    expect(cases.some((c) => c.expected.length > 1)).toBe(true);
  });

  for (const c of cases) {
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, async () => {
      expect(await lit(c.input.declaredOutputs, c.input.result)).toEqual(c.expected);
    });
  }
});

/**
 * Run a one-node graph and report what the node published.
 *
 * The kind is `hostRouter`, which no runtime ships, and no registry is
 * consulted for it. That is deliberate: the declared-port fallback reaches for
 * the KIND's ports before falling back to `out`, so naming a builtin here would
 * quietly assert the builtin's ports instead of the rule under test.
 *
 * `declaredOutputs` goes in `data.outputs`, where this runtime's xyflow-shaped
 * FlowNode keeps them — PHP, Python and Rust have a flattened `node.outputs`.
 * The table asks about the engine's rule, not about where a document stores it.
 */
async function lit(declaredOutputs: string[] | null, result: unknown): Promise<Lit[]> {
  const data: Record<string, unknown> = {};
  if (declaredOutputs !== null) data.outputs = declaredOutputs.map((id) => ({ id }));

  const events: RunEvent[] = [];
  await runFlow(
    { nodes: [{ id: "r", type: "hostRouter", position: { x: 0, y: 0 }, data }], edges: [] } as never,
    { hostRouter: () => result } as never,
    (e) => events.push(e),
  );

  // Emission order, not sorted: a map-shaped `__ports` lights its ports in the
  // order the map declares them, and row 0105 is only an assertion at all
  // because this list is left in the order the engine produced it.
  return events
    .filter((e): e is Extract<RunEvent, { type: "node-output" }> => e.type === "node-output")
    .filter((e) => e.nodeId === "r")
    .map((e) => ({ port: e.portId, value: e.value }));
}
