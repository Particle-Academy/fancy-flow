/**
 * A kind that SHIPS an executor must be runnable without the host registering
 * one.
 *
 * `NodeKindDefinition.executor` has existed since `subflow` was written, and
 * `pickExecutor` never read it. So `subflow` and `llm_router` both declared
 * their executor beside their schema, in the same object, and the engine could
 * not reach either: a consumer who called `registerBuiltinKinds()` and ran a
 * graph containing a subflow node got
 *
 *     No executor registered for kind=subflow — tried "n1", "subflow", …
 *
 * about a kind that is registered and that ships exactly the executor the
 * message says is missing.
 *
 * It survived because both are unit-tested by calling the executor DIRECTLY.
 * That proves the executor works and asserts nothing about whether anything
 * reaches it — the same shape as a bridge exported from source but absent from
 * `package.json`, or a field carried to a serving layer that drops it. The only
 * test that catches it is one that goes in through the front door, which is why
 * this file runs `runFlow` rather than the executor.
 *
 * Found while adding the terminal nodes, which ship executors the same way and
 * were dead on arrival for the same reason.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { registerNodeKind } from "../src/registry/registry";
import { registerWorkflowResolver } from "../src/registry/capabilities";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph } from "../src/types";

const graph = (nodes: Array<Record<string, unknown>>) =>
  ({ nodes, edges: [] }) as unknown as FlowGraph;

beforeEach(() => {
  registerBuiltinKinds();
});

describe("a kind's own executor", () => {
  test("runs when the host registered nothing", async () => {
    registerNodeKind({
      name: "@test/ships-an-executor",
      category: "custom",
      label: "Ships an executor",
      inputs: [],
      outputs: [{ id: "out" }],
      executor: () => "from the kind",
    });

    const result = await runFlow(
      graph([{ id: "n1", type: "@test/ships-an-executor", position: { x: 0, y: 0 }, data: {} }]),
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.outputs.n1).toBe("from the kind");
  });

  test("loses to a host executor registered for the same kind", async () => {
    // The precedence is the contract, not an accident of ordering. A kind's
    // executor is a DEFAULT — the package's whole design is that hosts decide
    // where memory, network and AI calls actually go, so a builtin that could
    // not be overridden would be worse than one that never ran.
    registerNodeKind({
      name: "@test/overridable",
      category: "custom",
      label: "Overridable",
      inputs: [],
      outputs: [{ id: "out" }],
      executor: () => "from the kind",
    });

    const result = await runFlow(
      graph([{ id: "n1", type: "@test/overridable", position: { x: 0, y: 0 }, data: {} }]),
      { "@test/overridable": () => "from the host" },
    );

    expect(result.outputs.n1).toBe("from the host");
  });

  test("reaches the builtin subflow node through runFlow", async () => {
    // The pre-existing case, stated concretely. Against the old `pickExecutor`
    // this fails with "No executor registered for kind=subflow".
    const restore = registerWorkflowResolver(() => ({
      nodes: [{ id: "c1", type: "@test/child", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }) as unknown as FlowGraph);

    const result = await runFlow(
      graph([
        {
          id: "n1",
          type: "@particle-academy/subflow",
          position: { x: 0, y: 0 },
          data: { config: { workflow: "child-flow" } },
        },
      ]),
      { "@test/child": () => "child ran" },
    );

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();

    restore();
  });
});
