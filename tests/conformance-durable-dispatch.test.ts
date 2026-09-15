/**
 * Which node a queued run hands out next — the shared table, run against THIS
 * side's own frontier and selection.
 *
 * fancy-flow-php#17 made serial the default in every runtime: a node goes to the
 * queue only once the node before it has settled, in declaration order, and a
 * paused gate keeps its slot. Parallel dispatch is an opt-in
 * (`maxConcurrent: UNLIMITED_CONCURRENCY`).
 *
 * The simulation is the manifest's, step for step. It exercises the SAME two
 * functions `Coordinator.advance()` calls — `Frontier.compute` and
 * `selectDispatch` — with no store, no queue and no engine execution, which is
 * what lets the PHP and Python coordinators answer the identical question.
 *
 * The rows that carry the weight:
 *
 *  - `0001` — the default. Before this change the TS coordinator had no budget
 *    at all and dispatched the whole frontier.
 *  - `0007` — declaration order among what is ready NOW; breadth-first fails it.
 *  - `0008` / `0010` — a paused gate holds its slot, alone and under a cap. This
 *    runtime does not park the run on a pause, so this is the rule that stops a
 *    later `advance()` handing out the gate's siblings.
 *  - `0014` — a cap is measured against held work, not the size of one batch.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/durable-dispatch/cases.json" with { type: "json" };
import { Frontier, NodeRunStatus, UNLIMITED_CONCURRENCY, selectDispatch, type NodeState } from "../src/durable";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { importWorkflow } from "../src/schema/workflow-schema";

type Trace = { trace: string[]; neverDispatched: string[] };

type Case = {
  id: string;
  title: string;
  expected: Trace;
  skip?: Record<string, string>;
  input: {
    schema: unknown;
    maxConcurrent: number;
    publishes?: Record<string, string[]>;
    pauses?: string[];
  };
};

const cases = (CASES as { cases: Case[] }).cases;

// The frontier settles notes and layout without dispatching them, and it asks
// the kind registry which kinds those are.
registerBuiltinKinds();

describe("flow/durable-dispatch", () => {
  const results: Array<{ id: string; passed: boolean }> = [];

  // The vacuity guard. A table that failed to load, or a runner that skipped
  // rows, would pass every assertion below by making none.
  it("loaded the shared table", () => {
    expect(cases).toHaveLength(14);
    expect(cases.some((c) => c.input.maxConcurrent === UNLIMITED_CONCURRENCY)).toBe(true);
    expect(cases.some((c) => (c.input.pauses ?? []).length > 0)).toBe(true);
  });

  for (const c of cases) {
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, () => {
      let passed = false;
      try {
        expect(dispatchTrace(c)).toEqual(c.expected);
        passed = true;
      } finally {
        results.push({ id: c.id, passed });
      }
    });
  }

  it("passed every row (14 of 14)", () => {
    // Declared last, so vitest runs it after every row above.
    expect(results.filter((r) => r.passed).map((r) => r.id)).toHaveLength(14);
  });
});

/**
 * The manifest's `dispatchTrace`, over this runtime's own functions.
 *
 * The document is imported leniently with the built-in kinds registered, the
 * way a durable host loads a stored workflow.
 */
function dispatchTrace(c: Case): Trace {
  const { graph } = importWorkflow(c.input.schema, { lenient: true });
  const pauses = c.input.pauses ?? [];
  const publishes = c.input.publishes ?? {};

  const state: Record<string, NodeState> = {};
  const inFlight: string[] = [];
  const trace: string[] = [];

  const row = (status: NodeState["status"], ports: readonly string[] = []): NodeState => ({
    status,
    ports,
    attempts: 1,
    firstAttemptAt: "",
  });

  for (let step = 0; step < 1000; step++) {
    const frontier = Frontier.compute(graph, state);
    for (const id of frontier.skipped) {
      state[id] = row(NodeRunStatus.SKIPPED);
      trace.push(`skip ${id}`);
    }

    // `maxConcurrent` is handed over as the table gives it: 0 is this runtime's
    // UNLIMITED_CONCURRENCY, exactly as the manifest's null limit.
    for (const id of selectDispatch(frontier.ready, state, c.input.maxConcurrent)) {
      state[id] = row(NodeRunStatus.CLAIMED);
      inFlight.push(id);
      trace.push(`dispatch ${id}`);
    }

    if (inFlight.length === 0) break;

    const id = inFlight.shift()!;
    if (pauses.includes(id)) {
      state[id] = row(NodeRunStatus.PAUSED);
      trace.push(`pause ${id}`);
    } else {
      state[id] = row(NodeRunStatus.COMPLETED, publishes[id] ?? ["out"]);
      trace.push(`complete ${id}`);
    }
  }

  return {
    trace,
    neverDispatched: graph.nodes.filter((n) => !(n.id in state)).map((n) => n.id),
  };
}
