/**
 * Workflow props — what a workflow DECLARES that it accepts.
 *
 * ## The gap this closes
 *
 * `initialInputs` is keyed BY NODE ID. A caller therefore has to know that the
 * trigger node happens to be called `t`, and renaming that node breaks every
 * caller without breaking the graph — the rename looks safe, and nothing
 * anywhere reports it.
 *
 * Worse, nothing declares what a workflow ACCEPTS. There are no names, no
 * types, no defaults, no validation. An agent composing a call cannot know what
 * to pass, and **a wrong key fails silently** — the value is simply never read,
 * the run reports success, and the output is quietly wrong. That is the same
 * shape as every defect our heaviest consumer has filed.
 *
 * So a workflow declares `inputs`, and a caller passes a flat object BY NAME.
 *
 * ## Reach: both, deliberately
 *
 * Props arrive two ways, because either one alone leaves a hole:
 *
 *  - **Entry nodes are seeded** with them, so a graph that reads `{{ topic }}`
 *    on its trigger keeps working when a caller moves from `initialInputs` to
 *    props. Nothing about existing graphs has to change.
 *  - **Every node gets `$props`**, so a node six hops downstream can read
 *    `{{ $props.topic }}` without threading the value through every edge
 *    between here and there.
 *
 * The second is free rather than clever: `$props` is an ordinary key in the
 * inputs object, and `resolvePath` already walks dot-paths against that object.
 * No resolver in any runtime needed changing, which is what keeps the three
 * from drifting.
 *
 * Neither reach ever CLOBBERS. A value that arrived by edge or by
 * `initialInputs` wins, on the same rule the source-node-id alias follows.
 */
import { describe, expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import { exportWorkflow } from "../src/schema/workflow-schema";
import type { RunEvent } from "../src/types";

type Seen = Record<string, unknown>;

/** A one-node graph whose executor records what it was handed. */
function graphWith(inputs?: unknown, extraNodes: unknown[] = [], extraEdges: unknown[] = []) {
  return {
    ...(inputs === undefined ? {} : { inputs }),
    nodes: [{ id: "t", type: "sink", position: { x: 0, y: 0 }, data: {} }, ...extraNodes],
    edges: extraEdges,
  };
}

async function runWith(graph: unknown, props?: Record<string, unknown>) {
  let seen: Seen = {};
  const events: RunEvent[] = [];

  const result = await runFlow(
    graph as never,
    {
      sink: (ctx: { inputs: Seen }) => {
        seen = ctx.inputs;
        return 1;
      },
      pass: (ctx: { inputs: Seen }) => ({ value: "upstream" }),
      tail: (ctx: { inputs: Seen }) => {
        seen = ctx.inputs;
        return 1;
      },
    } as never,
    (e) => events.push(e),
    (props === undefined ? {} : { props }) as never,
  );

  return { seen, result, events };
}

describe("declaring and passing props", () => {
  test("a caller passes values BY NAME, not by node id", async () => {
    const { seen, result } = await runWith(
      graphWith([{ name: "topic", type: "string" }]),
      { topic: "otters" },
    );

    expect(result.ok).toBe(true);
    // Seeded onto the entry node, so a graph reading `{{ topic }}` keeps working.
    expect(seen.topic).toBe("otters");
    // And available everywhere as `$props`.
    expect(seen.$props).toEqual({ topic: "otters" });
  });

  test("a declared default fills in when the caller omits it", async () => {
    const { seen, result } = await runWith(
      graphWith([{ name: "limit", type: "number", default: 10 }]),
      {},
    );

    expect(result.ok).toBe(true);
    expect(seen.limit).toBe(10);
    expect(seen.$props).toEqual({ limit: 10 });
  });

  test("an explicit value beats the default, including a falsy one", async () => {
    // `0`, `false` and `""` are real values. A default applied with `??` on the
    // wrong side, or with `||`, silently overrides them — and a limit of 0
    // becoming 10 is not an error anyone sees.
    const { seen } = await runWith(
      graphWith([
        { name: "limit", type: "number", default: 10 },
        { name: "dryRun", type: "boolean", default: true },
        { name: "note", type: "string", default: "unset" },
      ]),
      { limit: 0, dryRun: false, note: "" },
    );

    expect(seen.limit).toBe(0);
    expect(seen.dryRun).toBe(false);
    expect(seen.note).toBe("");
  });
});

describe("validation — the point is that a mistake is LOUD", () => {
  test("a missing required prop fails the run", async () => {
    const { result, events } = await runWith(
      graphWith([{ name: "topic", type: "string", required: true }]),
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("topic");
    expect(events.some((e) => e.type === "run-error")).toBe(true);
  });

  test("an UNKNOWN prop fails the run rather than sitting unread", async () => {
    // The whole reason this feature exists. Passing `{ topik: "otters" }`
    // previously did nothing at all: no error, no warning, and a run that
    // reported success while the node read an empty value.
    const { result } = await runWith(
      graphWith([{ name: "topic", type: "string" }]),
      { topik: "otters" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("topik");
  });

  test("a wrong type fails the run and names both types", async () => {
    const { result } = await runWith(
      graphWith([{ name: "limit", type: "number" }]),
      { limit: "ten" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("limit");
    expect(result.error).toContain("number");
  });

  test("a required prop WITH a default is satisfied by the default", async () => {
    // Required means "the run needs a value", not "the caller must type one".
    const { seen, result } = await runWith(
      graphWith([{ name: "limit", type: "number", required: true, default: 5 }]),
      {},
    );

    expect(result.ok).toBe(true);
    expect(seen.limit).toBe(5);
  });

  test("passing props to a graph that declares none fails loudly", async () => {
    // Otherwise the caller believes they configured the run and nothing did.
    const { result } = await runWith(graphWith(undefined), { topic: "otters" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("topic");
  });

  test("an untyped declaration accepts anything", async () => {
    // `type` is optional. Omitting it means "I am not asserting a shape",
    // which must not degrade into "nothing is allowed".
    const { seen, result } = await runWith(
      graphWith([{ name: "payload" }]),
      { payload: { nested: [1, 2] } },
    );

    expect(result.ok).toBe(true);
    expect(seen.payload).toEqual({ nested: [1, 2] });
  });
});

describe("reach and precedence", () => {
  test("$props reaches a node that is nowhere near the entry", async () => {
    // The reason `$props` exists at all: without it, a value the last node
    // needs has to be threaded through every node in between, and each hop is
    // a chance to drop it.
    const { seen, result } = await runWith(
      {
        inputs: [{ name: "topic", type: "string" }],
        nodes: [
          { id: "a", type: "pass", position: { x: 0, y: 0 }, data: {} },
          { id: "b", type: "pass", position: { x: 1, y: 0 }, data: {} },
          { id: "c", type: "tail", position: { x: 2, y: 0 }, data: {} },
        ],
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "b", target: "c" },
        ],
      },
      { topic: "otters" },
    );

    expect(result.ok).toBe(true);
    expect(seen.$props).toEqual({ topic: "otters" });
    // `c` is not an entry node, so it is NOT seeded with the bare name — only
    // entry points are, and `$props` is how everyone else reads them.
    expect(seen.topic).toBeUndefined();
  });

  test("a real input beats a seeded prop of the same name", async () => {
    // Never clobber. An edge or an initialInputs value is what the graph
    // actually computed; a prop is a default the caller supplied.
    let seen: Seen = {};

    await runFlow(
      {
        inputs: [{ name: "in", type: "string" }],
        nodes: [
          { id: "src", type: "pass", position: { x: 0, y: 0 }, data: {} },
          { id: "sink", type: "sink", position: { x: 1, y: 0 }, data: {} },
        ],
        edges: [{ id: "e1", source: "src", target: "sink" }],
      } as never,
      {
        pass: () => ({ value: "from the edge" }),
        sink: (ctx: { inputs: Seen }) => {
          seen = ctx.inputs;
          return 1;
        },
      } as never,
      () => {},
      { props: { in: "from the props" } } as never,
    );

    expect(seen.in).toEqual({ value: "from the edge" });
    // Still reachable unambiguously.
    expect(seen.$props).toEqual({ in: "from the props" });
  });

  test("a graph that declares NO inputs gets no $props key at all", async () => {
    // Corrected after the PHP golden fixtures caught it. An earlier draft
    // asserted `$props` was always present, reasoned as "so `{{ $props.x }}`
    // resolves to null rather than throwing" — but `resolvePath` returns null
    // for any unresolvable path, so the key changes nothing here. What it does
    // change is every executor's inputs on every graph, which showed up as a
    // diff in twelve stored goldens.
    const { seen } = await runWith(graphWith(undefined));

    expect("$props" in seen).toBe(false);
  });

  test("a declared-but-empty props map still yields $props", async () => {
    // Keyed on the DECLARATION, not on whether values arrived. A workflow whose
    // inputs are all optional and all omitted has still declared a contract, so
    // `{{ $props.note }}` is a meaningful thing to write against it.
    const { seen } = await runWith(graphWith([{ name: "note", type: "string" }]), {});

    expect(seen.$props).toEqual({});
  });
});

describe("the declaration survives a save/load round trip", () => {
  test("exportWorkflow writes inputs and importWorkflow reads them back", async () => {
    // Losing this on export means a saved workflow silently forgets its own
    // contract; losing it on IMPORT is worse — the document still declares
    // what it accepts, the loaded graph does not, and every prop a caller
    // passes comes back as "unknown input", blaming the caller for a bug in
    // the loader.
    const { exportWorkflow, importWorkflow } = await import("../src/schema/workflow-schema");

    const inputs = [
      { name: "topic", type: "string" as const, required: true },
      { name: "limit", type: "number" as const, default: 10 },
    ];

    const doc = exportWorkflow({
      nodes: [{ id: "t", type: "sink", position: { x: 0, y: 0 }, data: { label: "T" } }],
      edges: [],
      inputs,
    } as never);

    expect(doc.inputs).toEqual(inputs);

    const round = importWorkflow(JSON.parse(JSON.stringify(doc)));
    expect(round.graph.inputs).toEqual(inputs);
  });

  test("a workflow that declares none carries no key at all", () => {
    // Not `inputs: []`. An empty array on every existing document would be a
    // wire change for no gain and would make every saved-graph diff noisy.
    const doc = exportWorkflow({
      nodes: [{ id: "t", type: "sink", position: { x: 0, y: 0 }, data: { label: "T" } }],
      edges: [],
    } as never);

    expect("inputs" in doc).toBe(false);
  });
});
