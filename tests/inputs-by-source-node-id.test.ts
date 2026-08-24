/**
 * A node's inputs are also addressable by the SOURCE NODE'S ID.
 *
 * Requested as fancy-flow-php#8 by the suite's heaviest flow consumer, and the
 * reason is the failure mode rather than the ergonomics.
 *
 * Authors reach for node ids: every graph tool addresses nodes that way, so
 * `{{ n2.text }}` is the first thing written — by people, and far more often by
 * assistants generating graphs. Today that resolves to nothing and **nothing
 * fails**: `Expr` yields `""` for an unresolvable path, so the node runs, the
 * run reports success, and the damage is output that is quietly wrong.
 *
 * Their real case: a `document` node with filename `{{ n3.title }}` and content
 * `{{ n3.transcript }}` produced a file called `document.md` containing the
 * literal text of its own template. The run was green. A human found it.
 *
 * `targetHandle` already covers this and is the right mechanism where a node
 * must read something other than its immediate predecessor — but it is set on
 * the EDGE, which is not where an author is looking while writing a node's
 * config. The model is not wrong; the obvious spelling silently means nothing.
 *
 * So this is ADDITIVE and never shadows an explicit handle: the alias is only
 * written when an edge declared no `targetHandle`, and only when nothing has
 * already claimed that key.
 */
import { describe, expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";

type Seen = Record<string, unknown>;

/** Run a two-node graph and return what the downstream node received. */
async function inputsOf(edge: Record<string, unknown>, initialInputs?: Record<string, Record<string, unknown>>) {
  let seen: Seen = {};
  const graph = {
    nodes: [
      { id: "n2", type: "src", position: { x: 0, y: 0 }, data: {} },
      { id: "sink", type: "sink", position: { x: 1, y: 0 }, data: {} },
    ],
    edges: [{ id: "e1", source: "n2", target: "sink", ...edge }],
  };

  await runFlow(
    graph as never,
    {
      src: () => ({ text: "hello", title: "T" }),
      sink: (ctx: { inputs: Seen }) => { seen = ctx.inputs; return 1; },
    } as never,
    () => {},
    (initialInputs ? { initialInputs } : {}) as never,
  );
  return seen;
}

describe("inputs addressable by source node id", () => {
  test("a node fed by n2 can read EITHER in or n2", async () => {
    const inputs = await inputsOf({});

    expect(inputs.in, "the existing spelling still works").toEqual({ text: "hello", title: "T" });
    expect(inputs.n2, "and so does the one authors actually write").toEqual({ text: "hello", title: "T" });
  });

  test("an explicit targetHandle is NOT shadowed, and gets no alias", async () => {
    // The alias exists for edges that declared nothing. An edge that named a
    // handle said what it meant, and adding a second key under the source id
    // would quietly widen a deliberate contract.
    const inputs = await inputsOf({ targetHandle: "context" });

    expect(inputs.context).toEqual({ text: "hello", title: "T" });
    expect(inputs.in, "no default port was written").toBeUndefined();
    expect(inputs.n2, "an explicit handle opts out of the alias").toBeUndefined();
  });

  test("never clobbers a value already seeded under that key", async () => {
    // Initial inputs are the host's, and a node id that happens to collide with
    // a seeded key must not silently lose the host's value.
    const inputs = await inputsOf({}, { sink: { n2: "seeded by the host" } });

    expect(inputs.n2).toBe("seeded by the host");
    expect(inputs.in, "the edge still lands on its own port").toEqual({ text: "hello", title: "T" });
  });

  test("a dead branch contributes no alias", async () => {
    // The merge-point rule: an edge whose source never fired has no value, and
    // writing `undefined` under its node id would make an unreached node look
    // like it produced nothing rather than not having run.
    let seen: Seen = {};
    const graph = {
      nodes: [
        { id: "d", type: "decide", position: { x: 0, y: 0 }, data: {} },
        { id: "taken", type: "src", position: { x: 1, y: 0 }, data: {} },
        { id: "dead", type: "src", position: { x: 1, y: 1 }, data: {} },
        { id: "merge", type: "sink", position: { x: 2, y: 0 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "d", sourceHandle: "yes", target: "taken" },
        { id: "e2", source: "d", sourceHandle: "no", target: "dead" },
        { id: "e3", source: "taken", target: "merge" },
        { id: "e4", source: "dead", target: "merge" },
      ],
    };

    await runFlow(
      graph as never,
      {
        decide: () => ({ branch: "yes", value: true }),
        src: () => ({ text: "ran" }),
        sink: (ctx: { inputs: Seen }) => { seen = ctx.inputs; return 1; },
      } as never,
      () => {},
    );

    expect(seen.taken).toEqual({ text: "ran" });
    expect("dead" in seen, "a branch that never fired contributes nothing").toBe(false);
  });
});
