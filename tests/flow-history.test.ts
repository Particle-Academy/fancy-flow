// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FlowGraph } from "../src/types";
import type { UseFlowStateReturn } from "../src/runtime/use-flow-state";
import { useFlowHistory } from "../src/runtime/use-flow-history";

const node = (id: string, x = 0, y = 0): any => ({ id, position: { x, y }, data: {} });

/**
 * Drive useFlowHistory over a fake in-memory sink (no xyflow). `sync()` re-runs
 * the hook with a fresh sink reflecting the latest graph — what a real editor
 * re-render does when `flow.nodes` change.
 */
function setup(initial: FlowGraph = { nodes: [], edges: [] }) {
  let graph = initial;
  const makeSink = (): UseFlowStateReturn => ({
    nodes: graph.nodes,
    edges: graph.edges,
    setNodes: (n: any) => {
      graph = { nodes: typeof n === "function" ? n(graph.nodes) : n, edges: graph.edges };
    },
    setEdges: (e: any) => {
      graph = { nodes: graph.nodes, edges: typeof e === "function" ? e(graph.edges) : e };
    },
    setGraph: (g: FlowGraph) => {
      graph = g;
    },
    onNodesChange: () => {},
    onEdgesChange: () => {},
    onConnect: () => {},
    toGraph: () => graph,
  });
  const view = renderHook((p: { flow: UseFlowStateReturn }) => useFlowHistory(p.flow), {
    initialProps: { flow: makeSink() },
  });
  return {
    view,
    sync: () => view.rerender({ flow: makeSink() }),
    ids: () => graph.nodes.map((n) => n.id),
    edgeIds: () => graph.edges.map((e: any) => e.id),
    graph: () => graph,
  };
}

const flushTick = () => act(async () => { await Promise.resolve(); });

describe("useFlowHistory", () => {
  it("captures a committing mutation, then undo + redo restore it", async () => {
    const t = setup({ nodes: [node("a")], edges: [] });

    act(() => t.view.result.current.flow.setNodes((ns: any) => [...ns, node("b")]));
    t.sync();
    expect(t.ids()).toEqual(["a", "b"]);
    expect(t.view.result.current.canUndo).toBe(true);
    expect(t.view.result.current.canRedo).toBe(false);

    act(() => t.view.result.current.undo());
    t.sync();
    expect(t.ids()).toEqual(["a"]);
    expect(t.view.result.current.canRedo).toBe(true);

    act(() => t.view.result.current.redo());
    t.sync();
    expect(t.ids()).toEqual(["a", "b"]);
  });

  it("coalesces a burst (delete = setNodes + setEdges) into ONE undo step", () => {
    const t = setup({
      nodes: [node("a"), node("b")],
      edges: [{ id: "e", source: "a", target: "b" } as any],
    });

    // Both writes in the same tick — as api.deleteNodes' two calls would be.
    act(() => {
      t.view.result.current.flow.setNodes((ns: any) => ns.filter((n: any) => n.id !== "b"));
      t.view.result.current.flow.setEdges(() => []);
    });
    t.sync();
    expect(t.ids()).toEqual(["a"]);
    expect(t.edgeIds()).toEqual([]);

    // One undo restores BOTH the node and its edge...
    act(() => t.view.result.current.undo());
    t.sync();
    expect(t.ids()).toEqual(["a", "b"]);
    expect(t.edgeIds()).toEqual(["e"]);
    // ...and it was a single step.
    expect(t.view.result.current.canUndo).toBe(false);
  });

  it("keeps ops in separate ticks as separate undo steps", async () => {
    const t = setup({ nodes: [node("a")], edges: [] });

    act(() => t.view.result.current.flow.setNodes((ns: any) => [...ns, node("b")]));
    t.sync();
    await flushTick(); // release the per-tick coalesce guard

    act(() => t.view.result.current.flow.setNodes((ns: any) => [...ns, node("c")]));
    t.sync();
    expect(t.ids()).toEqual(["a", "b", "c"]);

    act(() => t.view.result.current.undo());
    t.sync();
    expect(t.ids()).toEqual(["a", "b"]); // only the second op reverted
    expect(t.view.result.current.canUndo).toBe(true); // first op still undoable
  });

  it("onNodeDragStart snapshots the pre-drag graph so a drag undoes to origin", () => {
    const t = setup({ nodes: [node("a", 0, 0)], edges: [] });

    act(() => t.view.result.current.onNodeDragStart());
    // The commit that a drag-stop ultimately produces:
    act(() => t.view.result.current.flow.setGraph({ nodes: [node("a", 200, 120)], edges: [] }));
    t.sync();
    expect(t.graph().nodes[0].position).toEqual({ x: 200, y: 120 });

    act(() => t.view.result.current.undo());
    t.sync();
    expect(t.graph().nodes[0].position).toEqual({ x: 0, y: 0 });
  });
});
