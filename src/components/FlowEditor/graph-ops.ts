import { reconnectEdge as xyReconnectEdge, type Connection, type Edge } from "@xyflow/react";
import type { FlowGraph, FlowNode } from "../../types";

/**
 * Remove nodes AND every edge attached to them.
 *
 * Deleting a node without pruning its edges leaves danglers that point at
 * nothing — they survive a round-trip through the schema and blow up the
 * runner, so the two always move together.
 */
export function removeNodes(graph: FlowGraph, ids: string[]): FlowGraph {
  if (ids.length === 0) return graph;
  const doomed = new Set(ids);

  return {
    nodes: graph.nodes.filter((n) => !doomed.has(n.id)),
    edges: graph.edges.filter((e) => !doomed.has(e.source) && !doomed.has(e.target)),
  };
}

/** Remove edges by id, leaving nodes untouched. */
export function removeEdges(edges: Edge[], ids: string[]): Edge[] {
  if (ids.length === 0) return edges;
  const doomed = new Set(ids);

  return edges.filter((e) => !doomed.has(e.id));
}

/**
 * Set (or clear) an edge's label.
 *
 * An empty/whitespace label is removed rather than stored as `""` — xyflow
 * renders an empty label as an empty chip on the wire, and a blank key would
 * survive export into the workflow schema.
 */
export function setEdgeLabel(edges: Edge[], id: string, label: string | undefined): Edge[] {
  const next = label?.trim();
  return edges.map((e) => {
    if (e.id !== id) return e;
    if (!next) {
      const { label: _drop, ...rest } = e;
      return rest as Edge;
    }
    return { ...e, label: next };
  });
}

/** Copy a node with a fresh id, offset so it doesn't sit exactly on top. */
export function duplicateNode(node: FlowNode, id: string, offset = 40): FlowNode {
  return {
    ...node,
    id,
    position: { x: node.position.x + offset, y: node.position.y + offset },
    // Deep copy so the clone's config edits don't mutate the original.
    data: JSON.parse(JSON.stringify(node.data ?? {})),
  } as FlowNode;
}

/**
 * Clone a set of nodes AND the edges internal to that set, remapping every id.
 * This is the piece `duplicateNode` lacks: a copy/paste (or duplicate-selection)
 * that preserves the wiring *between* the copied nodes. Edges with an endpoint
 * outside the set are dropped (they'd dangle). A `parentId` pointing inside the
 * set is remapped; one pointing outside is detached.
 */
export function cloneSubgraph(
  nodes: FlowNode[],
  edges: Edge[],
  opts: { makeId: () => string; offset?: number },
): { nodes: FlowNode[]; edges: Edge[]; idMap: Map<string, string> } {
  const offset = opts.offset ?? 40;
  const idMap = new Map<string, string>();
  for (const n of nodes) idMap.set(n.id, opts.makeId());

  const clonedNodes = nodes.map((n) => {
    const cloned = duplicateNode(n, idMap.get(n.id)!, offset) as any;
    const parentId = (n as any).parentId;
    if (parentId && idMap.has(parentId)) cloned.parentId = idMap.get(parentId);
    else if (parentId) delete cloned.parentId;
    return cloned as FlowNode;
  });

  const clonedEdges = edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ ...e, id: opts.makeId(), source: idMap.get(e.source)!, target: idMap.get(e.target)! }));

  return { nodes: clonedNodes, edges: clonedEdges, idMap };
}

/**
 * Rewire one edge's endpoint(s) — wraps xyflow's `reconnectEdge`. Keeps the
 * edge's id (`shouldReplaceId: false`) so its label and identity survive the
 * rewire instead of being regenerated from the new endpoints.
 */
export function reconnectEdge(edges: Edge[], oldEdge: Edge, newConnection: Connection): Edge[] {
  return xyReconnectEdge(oldEdge, newConnection, edges, { shouldReplaceId: false });
}

export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

const nodeW = (n: FlowNode): number => (n as any).width ?? (n as any).measured?.width ?? 0;
const nodeH = (n: FlowNode): number => (n as any).height ?? (n as any).measured?.height ?? 0;

/** Align a selection to a shared edge/center of its bounding box. */
export function alignNodes(nodes: FlowNode[], edge: AlignEdge): FlowNode[] {
  if (nodes.length < 2) return nodes;
  const minL = Math.min(...nodes.map((n) => n.position.x));
  const maxR = Math.max(...nodes.map((n) => n.position.x + nodeW(n)));
  const minT = Math.min(...nodes.map((n) => n.position.y));
  const maxB = Math.max(...nodes.map((n) => n.position.y + nodeH(n)));
  const cx = (minL + maxR) / 2;
  const cy = (minT + maxB) / 2;
  return nodes.map((n) => {
    let { x, y } = n.position;
    if (edge === "left") x = minL;
    else if (edge === "right") x = maxR - nodeW(n);
    else if (edge === "hcenter") x = cx - nodeW(n) / 2;
    else if (edge === "top") y = minT;
    else if (edge === "bottom") y = maxB - nodeH(n);
    else if (edge === "vcenter") y = cy - nodeH(n) / 2;
    return { ...n, position: { x, y } };
  });
}

/**
 * Order nodes so every parent precedes its children — xyflow misrenders (and
 * warns) when a child appears before its `parentId` in the array. Stable
 * otherwise. Apply at the render boundary once grouping is in play.
 */
export function sortNodesParentFirst<T extends { id: string; parentId?: string }>(nodes: T[]): T[] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const seen = new Set<string>();
  const out: T[] = [];
  const visit = (n: T) => {
    if (seen.has(n.id)) return;
    const pid = (n as any).parentId as string | undefined;
    if (pid && byId.has(pid) && !seen.has(pid)) visit(byId.get(pid)!);
    seen.add(n.id);
    out.push(n);
  };
  for (const n of nodes) visit(n);
  return out;
}

/** Absolute position of a node, accounting for one level of parent nesting. */
function absolutePosition(node: FlowNode, nodes: FlowNode[]): { x: number; y: number } {
  const pid = (node as any).parentId as string | undefined;
  if (!pid) return node.position;
  const parent = nodes.find((n) => n.id === pid);
  return parent ? { x: node.position.x + parent.position.x, y: node.position.y + parent.position.y } : node.position;
}

/**
 * Put a node inside a lane/container: set `parentId` + `extent:'parent'` and
 * convert its position to be relative to the lane. Idempotent-safe; a no-op if
 * either id is missing or they're the same node.
 */
export function assignToLane(nodes: FlowNode[], nodeId: string, laneId: string): FlowNode[] {
  if (nodeId === laneId) return nodes;
  const node = nodes.find((n) => n.id === nodeId);
  const lane = nodes.find((n) => n.id === laneId);
  if (!node || !lane) return nodes;
  const abs = absolutePosition(node, nodes);
  const laneAbs = absolutePosition(lane, nodes);
  const rel = { x: abs.x - laneAbs.x, y: abs.y - laneAbs.y };
  return nodes.map((n) => (n.id === nodeId ? ({ ...n, parentId: laneId, extent: "parent", position: rel } as FlowNode) : n));
}

/** Take a node out of its lane: drop `parentId`/`extent`, restore absolute position. */
export function removeFromLane(nodes: FlowNode[], nodeId: string): FlowNode[] {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node || !(node as any).parentId) return nodes;
  const abs = absolutePosition(node, nodes);
  return nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const { parentId: _p, extent: _e, ...rest } = n as any;
    return { ...rest, position: abs } as FlowNode;
  });
}

/**
 * Stack lanes into contiguous rows (horizontal) or columns (vertical) — the
 * "fixed rows/columns" behavior. `isLane` picks which nodes are lanes; they're
 * ordered by their current cross-axis position and repacked from the first
 * lane's origin. Each lane keeps its own size (independently resizable).
 */
export function stackLanes(
  nodes: FlowNode[],
  isLane: (n: FlowNode) => boolean,
  opts: { orientation?: "horizontal" | "vertical"; gap?: number } = {},
): FlowNode[] {
  const orientation = opts.orientation ?? "horizontal";
  const gap = opts.gap ?? 12;
  const vertical = orientation === "vertical";
  const lanes = nodes.filter(isLane).sort((a, b) => (vertical ? a.position.x - b.position.x : a.position.y - b.position.y));
  if (lanes.length === 0) return nodes;
  const originX = lanes[0].position.x;
  const originY = lanes[0].position.y;
  const moves = new Map<string, { x: number; y: number }>();
  let cursor = vertical ? originX : originY;
  for (const lane of lanes) {
    moves.set(lane.id, vertical ? { x: cursor, y: originY } : { x: originX, y: cursor });
    cursor += (vertical ? ((lane as any).width ?? 320) : ((lane as any).height ?? 160)) + gap;
  }
  return nodes.map((n) => (moves.has(n.id) ? { ...n, position: moves.get(n.id)! } : n));
}

/** Evenly distribute a selection's gaps along an axis (needs 3+ nodes). */
export function distributeNodes(nodes: FlowNode[], axis: "h" | "v"): FlowNode[] {
  if (nodes.length < 3) return nodes;
  const size = (n: FlowNode) => (axis === "h" ? nodeW(n) : nodeH(n));
  const coord = (n: FlowNode) => (axis === "h" ? n.position.x : n.position.y);
  const sorted = [...nodes].sort((a, b) => coord(a) - coord(b));
  const start = coord(sorted[0]);
  const last = sorted[sorted.length - 1];
  const end = coord(last) + size(last);
  const totalSize = sorted.reduce((s, n) => s + size(n), 0);
  const gap = (end - start - totalSize) / (sorted.length - 1);
  const posById = new Map<string, number>();
  let cursor = start;
  for (const n of sorted) {
    posById.set(n.id, cursor);
    cursor += size(n) + gap;
  }
  return nodes.map((n) => {
    const p = posById.get(n.id)!;
    return { ...n, position: axis === "h" ? { ...n.position, x: p } : { ...n.position, y: p } };
  });
}
