import { describe, it, expect } from "vitest";
import type { Edge } from "@xyflow/react";
import type { FlowNode } from "../src/types";
import { cloneSubgraph, reconnectEdge, alignNodes, distributeNodes } from "../src/components/FlowEditor/graph-ops";

const node = (id: string, x = 0, y = 0, w = 100, h = 40, extra: Record<string, unknown> = {}): FlowNode =>
  ({ id, position: { x, y }, width: w, height: h, data: {}, ...extra } as any);

const edge = (id: string, source: string, target: string): Edge => ({ id, source, target } as Edge);

function counter() {
  let n = 0;
  return () => `x${++n}`;
}

describe("cloneSubgraph", () => {
  it("clones nodes and remaps the edges internal to the set", () => {
    const nodes = [node("a"), node("b")];
    const edges = [edge("e", "a", "b")];
    const { nodes: cn, edges: ce, idMap } = cloneSubgraph(nodes, edges, { makeId: counter() });
    expect(cn).toHaveLength(2);
    expect(ce).toHaveLength(1);
    // New ids, and the edge points at the clones (not the originals).
    expect(cn.map((n) => n.id)).toEqual([idMap.get("a"), idMap.get("b")]);
    expect(ce[0].source).toBe(idMap.get("a"));
    expect(ce[0].target).toBe(idMap.get("b"));
    expect(ce[0].id).not.toBe("e");
  });

  it("drops an edge with an endpoint outside the copied set", () => {
    const nodes = [node("a")];
    const edges = [edge("e", "a", "outside")];
    const { edges: ce } = cloneSubgraph(nodes, edges, { makeId: counter() });
    expect(ce).toEqual([]);
  });

  it("remaps a parentId inside the set and detaches one outside it", () => {
    const inside = cloneSubgraph(
      [node("lane"), node("a", 0, 0, 100, 40, { parentId: "lane" })],
      [],
      { makeId: counter() },
    );
    const child = inside.nodes.find((n) => (n as any).parentId);
    expect((child as any).parentId).toBe(inside.idMap.get("lane"));

    const outside = cloneSubgraph([node("a", 0, 0, 100, 40, { parentId: "gone" })], [], { makeId: counter() });
    expect((outside.nodes[0] as any).parentId).toBeUndefined();
  });

  it("deep-copies data so clone edits don't leak into the source", () => {
    const src = node("a", 0, 0, 100, 40, { data: { config: { n: 1 } } });
    const { nodes } = cloneSubgraph([src], [], { makeId: counter() });
    (nodes[0].data as any).config.n = 99;
    expect((src.data as any).config.n).toBe(1);
  });
});

describe("reconnectEdge", () => {
  it("rewires an edge's endpoint", () => {
    const edges = [edge("e1", "a", "b")];
    const next = reconnectEdge(edges, edges[0], { source: "a", target: "c", sourceHandle: null, targetHandle: null });
    expect(next.find((e) => e.id === "e1")?.target).toBe("c");
  });
});

describe("alignNodes", () => {
  const nodes = [node("a", 0, 0, 100, 40), node("b", 50, 100, 100, 40), node("c", 200, 50, 100, 40)];

  it("aligns left edges", () => {
    expect(alignNodes(nodes, "left").map((n) => n.position.x)).toEqual([0, 0, 0]);
  });
  it("aligns right edges (accounts for width)", () => {
    // bounding right = 300; each width 100 -> x = 200
    expect(alignNodes(nodes, "right").map((n) => n.position.x)).toEqual([200, 200, 200]);
  });
  it("aligns horizontal centers", () => {
    // center x = 150; width 100 -> x = 100
    expect(alignNodes(nodes, "hcenter").map((n) => n.position.x)).toEqual([100, 100, 100]);
  });
  it("aligns top edges", () => {
    expect(alignNodes(nodes, "top").map((n) => n.position.y)).toEqual([0, 0, 0]);
  });
  it("is a no-op for a single node", () => {
    expect(alignNodes([nodes[0]], "left")).toEqual([nodes[0]]);
  });
});

describe("distributeNodes", () => {
  it("evenly spaces gaps along the horizontal axis", () => {
    const nodes = [node("a", 0, 0, 100, 40), node("b", 150, 0, 100, 40), node("c", 400, 0, 100, 40)];
    // span 0..500, total width 300, 2 gaps -> gap 100: a=0, b=200, c=400
    const out = distributeNodes(nodes, "h");
    const byId = Object.fromEntries(out.map((n) => [n.id, n.position.x]));
    expect(byId).toEqual({ a: 0, b: 200, c: 400 });
  });
  it("needs at least three nodes", () => {
    const nodes = [node("a", 0), node("b", 100)];
    expect(distributeNodes(nodes, "h")).toEqual(nodes);
  });
});
