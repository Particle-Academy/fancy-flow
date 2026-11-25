import { MarkerType, type Edge } from "@xyflow/react";
import { mermaidBounds } from "../../mermaid/layout";
import type { MermaidEdgeMeta, MermaidEnd } from "../../mermaid/types";
import type { FlowEdge, FlowGraph } from "../../types";

const FALLBACK: MermaidEdgeMeta = { stroke: "normal", head: "arrow", tail: "none", length: 1 };

/**
 * An imported edge as React Flow should draw it: Mermaid's stroke, ends and
 * label. Circle and cross ends use the diagram's own SVG markers
 * (`<prefix>-circle`, `<prefix>-cross`), never an arrow standing in for them.
 * The label is passed as a string, which React Flow draws as SVG text.
 */
export function mermaidEdgeView(edge: FlowEdge, markerPrefix: string): Edge {
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
    type: "default",
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
