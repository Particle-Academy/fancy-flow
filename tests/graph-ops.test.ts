import { describe, expect, it } from "vitest";
import { duplicateNode, removeEdges, removeNodes } from "../src/components/FlowEditor/graph-ops";
import type { FlowGraph } from "../src/types";

const graph = (): FlowGraph => ({
  nodes: [
    { id: "a", position: { x: 0, y: 0 }, data: { config: { n: 1 } } },
    { id: "b", position: { x: 10, y: 10 }, data: {} },
    { id: "c", position: { x: 20, y: 20 }, data: {} },
  ] as FlowGraph["nodes"],
  edges: [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "c" },
    { id: "e3", source: "a", target: "c" },
  ] as FlowGraph["edges"],
});

describe("removeNodes", () => {
  it("deletes the node AND every edge touching it — no danglers", () => {
    const next = removeNodes(graph(), ["b"]);
    expect(next.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    // e1 (a→b) and e2 (b→c) both die with b; e3 (a→c) survives.
    expect(next.edges.map((e) => e.id)).toEqual(["e3"]);
  });

  it("prunes edges when a node is deleted from either end", () => {
    expect(removeNodes(graph(), ["a"]).edges.map((e) => e.id)).toEqual(["e2"]);
    expect(removeNodes(graph(), ["c"]).edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("handles multiple deletions and is a no-op for an empty list", () => {
    expect(removeNodes(graph(), ["a", "c"]).edges).toEqual([]);
    expect(removeNodes(graph(), [])).toEqual(graph());
  });
});

describe("removeEdges", () => {
  it("removes only the named edges, leaving nodes alone", () => {
    expect(removeEdges(graph().edges, ["e2"]).map((e) => e.id)).toEqual(["e1", "e3"]);
  });
});

describe("duplicateNode", () => {
  it("offsets the copy and deep-copies data so edits don't leak back", () => {
    const src = graph().nodes[0]!;
    const copy = duplicateNode(src, "a2");

    expect(copy.id).toBe("a2");
    expect(copy.position).toEqual({ x: 40, y: 40 });

    (copy.data as any).config.n = 99;
    expect((src.data as any).config.n).toBe(1);
  });
});
