/**
 * A subflow must run its child against THE SAME REGISTRY as its parent.
 *
 * Reported against the PHP twin by a consumer (fancy-flow-php#7): a child
 * graph containing a host-registered kind failed with `No executor registered
 * for kind=<host-kind>`, while the identical graph run at top level succeeded.
 * Same workflow, two different behaviours depending on nesting depth.
 *
 * **The TS engine had the same defect and a worse default.** `subflowExecutor`
 * ran the child against `(config.executors) ?? {}` — so unless the graph
 * happened to carry its own registry in config, the child ran against an
 * EMPTY one. Nothing warns: an unregistered kind fails closed with no outputs,
 * which is the correct default and exactly what makes this silent.
 *
 * The sharpest case is not a missing kind but a REPLACED one. A host that
 * overrides `llm_call` to add tenancy, budgeting or token accounting gets its
 * own version in the parent and the package's version in the child — the same
 * graph billing two different ways depending on where it was called from.
 *
 * The fix is inheritance by default: the runner hands the registry it is
 * running with to every executor, so anything that starts a nested run gets the
 * parent's registry without having to remember to. `config.executors` still
 * layers on top, so a graph that deliberately gives its child extra or
 * different executors keeps working.
 */
import { afterEach, describe, expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import { subflowExecutor } from "../src/registry/subflow";
import { registerWorkflowResolver } from "../src/registry/capabilities";
import type { RunEvent } from "../src/types";

// `config.workflow` is a REFERENCE the host resolves, not an inline graph —
// the host is where workflows live. Register a resolver per test and tear it
// down, so one test's graphs cannot leak into another's.
const teardown: Array<() => void> = [];
afterEach(() => { while (teardown.length) teardown.pop()!(); });

const useGraphs = (graphs: Record<string, unknown>) => {
  teardown.push(registerWorkflowResolver((ref: string) => graphs[ref] as never));
};

const childGraph = {
  nodes: [{ id: "c1", type: "host_kind", position: { x: 0, y: 0 }, data: { kind: "host_kind", label: "Host step" } }],
  edges: [],
};

/** A parent graph whose single node is a subflow pointing at the child. */
const parentGraph = (config: Record<string, unknown> = {}) => ({
  nodes: [{
    id: "sub",
    type: "subflow",
    position: { x: 0, y: 0 },
    data: { kind: "subflow", label: "Child", config: { workflow: "child", ...config } },
  }],
  edges: [],
});

describe("subflow registry inheritance", () => {
  test("a host kind resolves inside the child, not just at top level", async () => {
    // The reported failure, as a test: the same executor registry that runs
    // the parent must run the child.
    useGraphs({ child: childGraph });
    const executors = {
      subflow: subflowExecutor,
      host_kind: () => "host ran",
    };

    const events: RunEvent[] = [];
    const result = await runFlow(parentGraph() as never, executors as never, (e) => events.push(e));

    expect(
      events.filter((e) => e.type === "log" && e.level === "error").map((e) => (e as { message: string }).message),
      "no executor should be missing inside the child",
    ).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("the child uses the HOST's override of a kind, not the package's", async () => {
    // The expensive case. A host that replaces a builtin gets its version in
    // the parent and the package's in the child — the same graph behaving two
    // ways depending on nesting.
    useGraphs({ child: childGraph });
    const calls: string[] = [];
    const executors = {
      subflow: subflowExecutor,
      host_kind: () => { calls.push("host version"); return 1; },
    };

    await runFlow(parentGraph() as never, executors as never, () => {});

    expect(calls).toEqual(["host version"]);
  });

  test("config.executors still layers on top of the inherited registry", async () => {
    // Inheritance must not remove the ability to give a child something extra
    // or deliberately different.
    useGraphs({ child: childGraph });
    const calls: string[] = [];
    const executors = {
      subflow: subflowExecutor,
      host_kind: () => { calls.push("inherited"); return 1; },
    };
    const overridden = parentGraph({
      executors: { host_kind: () => { calls.push("child-specific"); return 2; } },
    });

    await runFlow(overridden as never, executors as never, () => {});

    expect(calls, "an explicit child executor wins over the inherited one").toEqual(["child-specific"]);
  });

  test("inheritance reaches a grandchild, not only one level down", async () => {
    // Depth is where a "pass it down once" fix quietly stops working.
    const grandchild = {
      nodes: [{ id: "g1", type: "host_kind", position: { x: 0, y: 0 }, data: { kind: "host_kind", label: "Deep" } }],
      edges: [],
    };
    const middle = {
      nodes: [{
        id: "m1",
        type: "subflow",
        position: { x: 0, y: 0 },
        data: { kind: "subflow", label: "Middle", config: { workflow: "grandchild" } },
      }],
      edges: [],
    };
    useGraphs({ child: middle, grandchild });
    const calls: string[] = [];
    const executors = {
      subflow: subflowExecutor,
      host_kind: () => { calls.push("deep"); return 1; },
    };

    const result = await runFlow(parentGraph() as never, executors as never, () => {});

    expect(result.ok).toBe(true);
    expect(calls).toEqual(["deep"]);
  });
});
