/**
 * `for_each` forwards what its item lane EMITS, as fancy-flow-php does (#25).
 *
 * Each iteration ran its lane with a no-op event sink, so every status, message
 * and log a lane node emitted was dropped. A host collecting events (a lab
 * snapshot, a progress feed) saw nothing from inside the loop: the PHP twin
 * recorded five per-item events for five items, and this engine recorded none.
 *
 * The rule is PHP's `RunEvent::forParent`: node-scoped events reach the parent
 * with their node id re-addressed as `<for_each id>/<index>/<node id>`, and the
 * lane's own run-start / run-end / run-error are NOT forwarded, because a lane
 * starting is not the workflow starting.
 */
import { beforeEach, expect, test } from "vitest";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph, FlowNode, RunEvent } from "../src/types";

function node(id: string, type: string, config: Record<string, unknown> = {}): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, config } } as unknown as FlowNode;
}

beforeEach(() => {
  registerBuiltinKinds();
});

test("events emitted inside each iteration reach the host, re-addressed per item", async () => {
  const graph = {
    nodes: [node("t", "manual_trigger"), node("each", "for_each", { source: "{{ in.rows }}" }), node("rec", "recorder")],
    edges: [
      { id: "e1", source: "t", target: "each" },
      { id: "e2", source: "each", target: "rec", sourceHandle: "item" },
    ],
  } as unknown as FlowGraph;

  const events: RunEvent[] = [];
  const result = await runFlow(
    graph,
    {
      manual_trigger: () => ({ rows: ["a", "b", "c"] }),
      recorder: (ctx) => {
        ctx.emit({ type: "log", nodeId: ctx.node.id, level: "info", message: "recorded", detail: { value: ctx.inputs.in } });
        return null;
      },
    },
    (event) => events.push(event),
  );

  expect(result.ok).toBe(true);
  const logs = events.filter((e) => e.type === "log" && e.message === "recorded");
  expect(logs.map((e) => (e as { nodeId?: string }).nodeId)).toEqual(["each/0/rec", "each/1/rec", "each/2/rec"]);
  expect(logs.map((e) => (e as { detail?: { value?: unknown } }).detail?.value)).toEqual(["a", "b", "c"]);

  // Lane-scoped node status is forwarded too, re-addressed.
  expect(events.some((e) => e.type === "node-status" && e.nodeId === "each/1/rec" && e.status === "done")).toBe(true);

  // The lanes' own run boundaries are not the parent's.
  expect(events.filter((e) => e.type === "run-start")).toHaveLength(1);
  expect(events.filter((e) => e.type === "run-end")).toHaveLength(1);
});
