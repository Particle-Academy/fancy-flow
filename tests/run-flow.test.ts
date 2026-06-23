import { describe, expect, it } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import type { ExecutorRegistry, FlowGraph } from "../src/types";

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as FlowGraph["nodes"][number];
const edge = (id: string, source: string, target: string, sourceHandle?: string) =>
  ({ id, source, target, sourceHandle }) as FlowGraph["edges"][number];

describe("runFlow — decision merge points (#1)", () => {
  // Trigger → Decision ─(a)→ Branch A ─┐
  //                    └(b)→ Branch B ─┴→ Shared → Output
  // The Decision routes to A; both branches feed the shared "merge" node.
  it("continues through a node shared by both decision branches", async () => {
    const graph: FlowGraph = {
      nodes: [
        node("trigger", "trigger"),
        node("decision", "decision", { outputs: [{ id: "a" }, { id: "b" }] }),
        node("branchA", "action"),
        node("branchB", "action"),
        node("shared", "action"),
        node("output", "output"),
      ],
      edges: [
        edge("e1", "trigger", "decision"),
        edge("e2", "decision", "branchA", "a"),
        edge("e3", "decision", "branchB", "b"),
        edge("e4", "branchA", "shared"),
        edge("e5", "branchB", "shared"),
        edge("e6", "shared", "output"),
      ],
    };

    const ran: string[] = [];
    const executors: ExecutorRegistry = {
      trigger: () => ({ ok: true }),
      decision: () => ({ branch: "a" }),
      action: ({ node }) => {
        ran.push(node.id);
        return { id: node.id };
      },
      output: ({ node }) => {
        ran.push(node.id);
        return { done: true };
      },
    };

    const result = await runFlow(graph, executors);

    expect(result.ok).toBe(true);
    expect(ran).toContain("branchA");
    expect(ran).toContain("shared"); // the merge point — was skipped before the fix (#1)
    expect(ran).toContain("output"); // execution reaches the end
    expect(ran).not.toContain("branchB"); // the not-taken branch stays skipped
  });

  // Two independent sources both feed one node — a genuine AND-join. The fix
  // (run on ANY active incoming, given topological order) must NOT regress this.
  it("still runs a genuine parallel join when both inputs are active", async () => {
    const graph: FlowGraph = {
      nodes: [node("a", "action"), node("b", "action"), node("join", "action")],
      edges: [edge("e1", "a", "join"), edge("e2", "b", "join")],
    };

    const ran: string[] = [];
    const executors: ExecutorRegistry = {
      action: ({ node }) => {
        ran.push(node.id);
        return { id: node.id };
      },
    };

    const result = await runFlow(graph, executors);

    expect(result.ok).toBe(true);
    expect(ran).toEqual(expect.arrayContaining(["a", "b", "join"]));
  });
});
