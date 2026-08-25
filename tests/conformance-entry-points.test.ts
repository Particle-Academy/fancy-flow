/**
 * Which entry point fired — the shared table, run against THIS side.
 *
 * A graph may hold more than one trigger, and a trigger has no inbound edges,
 * which IS the readiness rule — so every trigger's branch ran on every run,
 * whichever one fired. The triggers themselves are harmless; everything
 * DOWNSTREAM of the ones that did not fire is not.
 *
 * Reported against the PHP runtime with production measurements — a
 * `user_input` on the manual branch executing during an event-triggered run,
 * parking it to ask a person for data the event had already supplied — but the
 * defect was in all three runtimes, because all three share the rule.
 *
 * The table was written BEFORE any runtime implemented it, so it is a
 * specification rather than a post-mortem. `0101` is the one to read first: it
 * pins that UNSET behaves exactly as before, which is what keeps every
 * multi-trigger graph already in the field working.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/entry-points/cases.json" with { type: "json" };
import { runFlow } from "../src/runtime/run-flow";
import { registerBuiltinKinds } from "../src/registry/builtin";

type Case = {
  id: string;
  title: string;
  expected: string[];
  skip?: Record<string, string>;
  input: {
    schema: { graph: { nodes: unknown[]; edges: unknown[] } };
    initialInputs?: Record<string, Record<string, unknown>>;
    entryNodes: string[] | null;
  };
};

const cases = (CASES as { cases: Case[] }).cases;

registerBuiltinKinds();

describe("flow/entry-points", () => {
  it("loaded the shared table", () => {
    expect(cases.length).toBeGreaterThan(5);
  });

  for (const c of cases) {
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, async () => {
      // The document is a WorkflowSchema, so its nodes carry `kind` where the
      // runtime FlowNode wants `type`. Mapping here rather than teaching the
      // fixture two shapes: the schema form is what a consumer actually stores.
      const nodes = (c.input.schema.graph.nodes as Array<Record<string, any>>).map((n) => ({
        id: n.id,
        type: n.kind,
        position: n.position ?? { x: 0, y: 0 },
        data: { kind: n.kind, config: n.config ?? {} },
      }));

      const result = await runFlow(
        { nodes, edges: c.input.schema.graph.edges } as never,
        builtinExecutors(),
        () => {},
        {
          initialInputs: c.input.initialInputs ?? {},
          // `null` in the fixture means UNSET, and must not become `[]` — the
          // two are different rules and 0101 vs 0106 exist to pin that.
          entryNodes: c.input.entryNodes ?? undefined,
        },
      );

      // A node that ran has an entry in `outputs`; a skipped one does not.
      // Sorted because this suite asks WHICH nodes ran, not in what order.
      expect(Object.keys(result.outputs).sort()).toEqual(c.expected);
    });
  }
});

/**
 * Offline executors for the three kinds the table uses.
 *
 * Deliberately local and tiny rather than the package's full built-in set: the
 * question here is which nodes RUN, so an executor only has to be reachable and
 * produce something. Anything richer would couple these rows to behaviour
 * `flow/graph-runs` already pins.
 */
function builtinExecutors() {
  return {
    manual_trigger: (ctx: any) => ctx.inputs ?? {},
    transform: (ctx: any) => ctx.inputs?.in ?? ctx.inputs ?? null,
    output: (ctx: any) => ctx.inputs?.in ?? null,
  } as never;
}
