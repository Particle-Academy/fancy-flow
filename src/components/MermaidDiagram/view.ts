import { MarkerType, type Edge } from "@xyflow/react";
import { mermaidBounds } from "../../mermaid/layout";
import type { MermaidDirection, MermaidEdgeMeta, MermaidEnd, MermaidNodeMeta } from "../../mermaid/types";
import type { FlowEdge, FlowGraph } from "../../types";

const FALLBACK: MermaidEdgeMeta = { stroke: "normal", head: "arrow", tail: "none", length: 1 };

/** Handle ids on the side of every node, used only by back edges. */
export const MERMAID_BACK_IN = "back-in";
export const MERMAID_BACK_OUT = "back-out";

type Placed = { id: string; parentId?: string; position?: { x: number; y: number }; width?: number; height?: number };

/** Each node's effective direction: its subgraph's `direction`, else the enclosing one's. */
export function mermaidNodeDirections(graph: FlowGraph, base: MermaidDirection): Map<string, MermaidDirection> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, MermaidDirection>();
  // The direction a node is laid out in: its container's own `direction`, else
  // the direction the container itself is laid out in. Same rule as the layout.
  const of = (id: string, depth: number): MermaidDirection => {
    const known = out.get(id);
    if (known) return known;
    const parent = (byId.get(id) as { parentId?: string } | undefined)?.parentId;
    let dir = base;
    if (parent && byId.has(parent) && depth < 64) {
      const meta = (byId.get(parent)!.data as { mermaid?: MermaidNodeMeta } | undefined)?.mermaid;
      dir = meta?.direction ?? of(parent, depth + 1);
    }
    out.set(id, dir);
    return dir;
  };
  for (const n of graph.nodes) of(n.id, 0);
  return out;
}

/**
 * The ids of edges that run against the layout: both ends in the same
 * container (one layout run placed them), and the target is behind the source
 * along that container's direction. These are the cycle edges the layout
 * reversed. Edges across containers and self-loops are not included.
 */
export function mermaidBackEdges(graph: FlowGraph, directions: ReadonlyMap<string, MermaidDirection>): Set<string> {
  const byId = new Map((graph.nodes as unknown as Placed[]).map((n) => [n.id, n]));
  const center = (n: Placed, axis: "x" | "y") =>
    (n.position?.[axis] ?? 0) + ((axis === "x" ? n.width : n.height) ?? 0) / 2;
  const out = new Set<string>();
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t || (s.parentId ?? null) !== (t.parentId ?? null)) continue;
    const dir = directions.get(s.id) ?? "TB";
    const axis = dir === "LR" || dir === "RL" ? "x" : "y";
    const ahead = (center(t, axis) - center(s, axis)) * (dir === "RL" || dir === "BT" ? -1 : 1);
    if (ahead < 0) out.add(e.id);
  }
  return out;
}

/**
 * An imported edge as React Flow should draw it: Mermaid's stroke, ends and
 * label. Circle and cross ends use the diagram's own SVG markers
 * (`<prefix>-circle`, `<prefix>-cross`), never an arrow standing in for them.
 * The label is passed as a string, which React Flow draws as SVG text.
 */
export function mermaidEdgeView(edge: FlowEdge, markerPrefix: string, back = false): Edge {
  const meta = ((edge.data as { mermaid?: MermaidEdgeMeta } | undefined)?.mermaid ?? FALLBACK) as MermaidEdgeMeta;
  const marker = (end: MermaidEnd) => {
    if (end === "arrow") return { type: MarkerType.ArrowClosed, color: "var(--ff-edge)", width: 16, height: 16 };
    if (end === "circle") return `${markerPrefix}-circle`;
    if (end === "cross") return `${markerPrefix}-cross`;
    return undefined;
  };
  const style =
    meta.stroke === "dotted"
      ? { strokeDasharray: "5 4", strokeWidth: 1.5 }
      : meta.stroke === "thick"
        ? { strokeWidth: 3 }
        : { strokeWidth: 1.5 };
  const label = typeof edge.label === "string" ? edge.label : undefined;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    // A back edge leaves and enters by the side handles and steps around the
    // nodes; between the normal handles it would be a flat line beneath them.
    ...(back ? { type: "smoothstep", sourceHandle: MERMAID_BACK_OUT, targetHandle: MERMAID_BACK_IN } : { type: "default" }),
    ...(label ? { label } : {}),
    markerEnd: marker(meta.head),
    markerStart: marker(meta.tail),
    style,
    labelStyle: { fill: "var(--ff-fg)" },
    labelBgStyle: { fill: "var(--ff-canvas-bg)" },
    hidden: meta.stroke === "invisible",
    selectable: false,
    focusable: false,
    data: edge.data,
  };
}

/**
 * A canvas height for a diagram shown `width` pixels wide: the diagram's own
 * proportions, clamped. A wide LR chart gets a short canvas and a tall TB chart
 * a tall one, instead of every diagram sitting in the same fixed box.
 */
export function mermaidDiagramHeight(graph: FlowGraph, width: number, range: { min: number; max: number }): number {
  const { width: w, height: h } = mermaidBounds(graph);
  if (!(w > 0) || !(h > 0) || !(width > 0)) return range.min;
  const pad = 64;
  const ideal = Math.round((width * (h + pad)) / (w + pad));
  return Math.min(range.max, Math.max(range.min, ideal));
}
