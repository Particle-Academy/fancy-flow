import dagre from "@dagrejs/dagre";
import type { FlowGraph, FlowNode } from "../types";

export type AutoLayoutDirection = "LR" | "TB" | "RL" | "BT";

export type AutoLayoutOptions = {
  /** Rank direction. Default "LR" (left→right). */
  direction?: AutoLayoutDirection;
  /** Separation between nodes in the same rank. Default 48. */
  nodeSep?: number;
  /** Separation between ranks. Default 96. */
  rankSep?: number;
  /**
   * Lay out only the children of this node (relative coords) — the lane-scoped
   * "tidy this lane". Omit to lay out the top-level (parentless) graph.
   */
  scope?: string;
  defaultWidth?: number;
  defaultHeight?: number;
};

/**
 * Auto-arrange a graph into a tidy DAG layout with dagre. Returns the nodes with
 * new positions (edges untouched). `scope` restricts the layout to one parent's
 * children — powering a lane-scoped tidy. dagre is bundled, so consumers who
 * never call this still pay nothing to install it, and it works headlessly.
 *
 * React-free: reachable from anywhere, testable without a DOM.
 */
export function autoLayout(graph: FlowGraph, options: AutoLayoutOptions = {}): FlowNode[] {
  const dir = options.direction ?? "LR";
  const nodesep = options.nodeSep ?? 48;
  const ranksep = options.rankSep ?? 96;
  const dw = options.defaultWidth ?? 180;
  const dh = options.defaultHeight ?? 64;

  const inScope = (n: FlowNode) => (options.scope ? (n as any).parentId === options.scope : !(n as any).parentId);
  const targets = graph.nodes.filter(inScope);
  if (targets.length === 0) return graph.nodes;
  const ids = new Set(targets.map((n) => n.id));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep, ranksep });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of targets) {
    g.setNode(n.id, { width: (n as any).width ?? dw, height: (n as any).height ?? dh });
  }
  for (const e of graph.edges) {
    if (ids.has(e.source) && ids.has(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const pos = new Map<string, { x: number; y: number }>();
  for (const n of targets) {
    const d = g.node(n.id);
    // dagre positions are node centers; xyflow wants the top-left corner.
    if (d) pos.set(n.id, { x: d.x - d.width / 2, y: d.y - d.height / 2 });
  }
  return graph.nodes.map((n) => {
    const p = pos.get(n.id);
    return p ? { ...n, position: p } : n;
  });
}
