/**
 * An executor must be found by the node's KIND, not only by `node.type`.
 *
 * Every other reader in this package resolves a node's kind as
 * `data.kind ?? node.type` — the schema's own `kindName`, `FlowViewer`,
 * `FlowEditor`, `connection.ts`, `subflow-cycle.ts`, `use-flow-run.ts`, and
 * `availableVariables` in this very file. `pickExecutor` was the one exception:
 * it read `node.id`, then `node.type`, then the kind's aliases, and never looked
 * at `data.kind` at all.
 *
 * So a graph that carries its kind in `data.kind` — which the schema explicitly
 * supports, and which every UI surface honours — resolved to the `*` fallback,
 * or to nothing. **A registry keyed by kind never fired.** Nothing threw: an
 * unregistered kind fails closed with no outputs, which is the right default and
 * exactly what makes this silent.
 *
 * Reported by the Genie team integrating the package, who found it by RUNNING
 * the engine rather than reading it: *"Executor lookup is by `node.type`, never
 * `data.kind`. A kind-only registry never fires; a coarse one shadows a precise
 * one."*
 *
 * Verified against source before fixing: seven call sites read
 * `data.kind ?? node.type`; `pickExecutor` was the only one that did not.
 */
import { describe, expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";

const graph = (node: Record<string, unknown>) =>
  ({ nodes: [node], edges: [] }) as never;

describe("executor lookup", () => {
  test("finds an executor bound to the kind in data.kind", async () => {
    const result = await runFlow(
      graph({ id: "n1", position: { x: 0, y: 0 }, data: { kind: "@particle-academy/log" } }),
      { "@particle-academy/log": () => "ran" },
    );

    expect(result.outputs.n1).toBe("ran");
  });

  test("node.type still wins, because it is the more specific statement", async () => {
    // A node that says both should follow its own `type`. Preferring data.kind
    // would silently re-point graphs that already work.
    const result = await runFlow(
      graph({
        id: "n1",
        type: "@particle-academy/log",
        position: { x: 0, y: 0 },
        data: { kind: "@particle-academy/notify" },
      }),
      { "@particle-academy/log": () => "by-type", "@particle-academy/notify": () => "by-kind" },
    );

    expect(result.outputs.n1).toBe("by-type");
  });

  test("a per-node binding still beats both", async () => {
    const result = await runFlow(
      graph({ id: "n1", position: { x: 0, y: 0 }, data: { kind: "@particle-academy/log" } }),
      { n1: () => "by-id", "@particle-academy/log": () => "by-kind" },
    );

    expect(result.outputs.n1).toBe("by-id");
  });

  test("the kind's aliases resolve from data.kind too", async () => {
    // `log` is the bare alias of `@particle-academy/log`. A host that bound the
    // pre-namespacing name must keep working, which is the whole reason the
    // alias walk exists — it just never ran for data.kind.
    const result = await runFlow(
      graph({ id: "n1", position: { x: 0, y: 0 }, data: { kind: "@particle-academy/log" } }),
      { log: () => "by-alias" },
    );

    expect(result.outputs.n1).toBe("by-alias");
  });

  test("the wildcard still catches a kind nobody bound", async () => {
    // Guards the fix from overreaching: `*` must remain the last resort.
    const result = await runFlow(
      graph({ id: "n1", position: { x: 0, y: 0 }, data: { kind: "@acme/unknown" } }),
      { "*": () => "by-wildcard" },
    );

    expect(result.outputs.n1).toBe("by-wildcard");
  });
});
