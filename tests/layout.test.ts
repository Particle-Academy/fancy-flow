import { describe, it, expect } from "vitest";
import { autoLayout } from "../src/layout";
import type { FlowGraph } from "../src/types";

const node = (id: string, extra: Record<string, unknown> = {}): any => ({
  id,
  position: { x: 0, y: 0 },
  width: 100,
  height: 40,
  data: {},
  ...extra,
});

describe("autoLayout", () => {
  it("arranges a chain left-to-right in topological order (LR)", () => {
    const graph: FlowGraph = {
      nodes: [node("a"), node("b"), node("c")],
      edges: [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ] as any,
    };
    const x = Object.fromEntries(autoLayout(graph, { direction: "LR" }).map((n) => [n.id, n.position.x]));
    expect(x.a).toBeLessThan(x.b);
    expect(x.b).toBeLessThan(x.c);
  });

  it("repositions every laid-out node and keeps the node set intact", () => {
    const graph: FlowGraph = {
      nodes: [node("a"), node("b")],
      edges: [{ id: "e", source: "a", target: "b" }] as any,
    };
    const out = autoLayout(graph);
    expect(out).toHaveLength(2);
    expect(out.some((n) => n.position.x !== 0 || n.position.y !== 0)).toBe(true);
  });

  it("scope lays out only a lane's children — top-level nodes untouched", () => {
    const graph: FlowGraph = {
      nodes: [
        node("lane", { width: 400, height: 200 }),
        node("child1", { parentId: "lane", position: { x: 999, y: 999 } }),
        node("child2", { parentId: "lane", position: { x: 888, y: 888 } }),
        node("top", { position: { x: 50, y: 50 } }),
      ],
      edges: [{ id: "e", source: "child1", target: "child2" }] as any,
    };
    const out = autoLayout(graph, { scope: "lane" });
    expect(out.find((n) => n.id === "top")!.position).toEqual({ x: 50, y: 50 }); // out of scope
    expect(out.find((n) => n.id === "child1")!.position.x).not.toBe(999); // repositioned
  });

  it("is a no-op when the scope has no children", () => {
    const graph: FlowGraph = { nodes: [node("a")], edges: [] };
    expect(autoLayout(graph, { scope: "nonexistent" })).toBe(graph.nodes);
  });
});
