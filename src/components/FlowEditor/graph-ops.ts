import type { Edge } from "@xyflow/react";
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
