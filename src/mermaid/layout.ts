/**
 * Lay out an imported Mermaid graph with the package's own `./layout` (dagre).
 *
 * Sizes are estimated from the label text, because this runs headless — no DOM
 * to measure. Subgraphs are laid out inside-out: each container's members are
 * arranged first (edges that leave the container are projected onto the member
 * they come from), the container is sized to fit, and then the container takes
 * part in its parent's layout as one box. Member positions are relative to
 * their container, which is what React Flow's `parentId` expects.
 */
import { autoLayout, type AutoLayoutDirection } from "../layout";
import type { FlowEdge, FlowGraph, FlowNode } from "../types";
import type { MermaidDirection, MermaidNodeMeta, MermaidShape } from "./types";

const CHAR = 7.2;
const LINE = 18;
const WRAP = 220;
const PAD = 16;
const TITLE = 30;

type Size = { width: number; height: number };

/** A box big enough for the label in this shape, without a DOM to measure. */
export function mermaidNodeSize(label: string, shape: MermaidShape): Size {
  const lines = label.split("\n");
  const longest = Math.max(1, ...lines.map((l) => Array.from(l).length));
  const textWidth = Math.min(longest * CHAR, WRAP);
  const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil((Array.from(l).length * CHAR) / WRAP)), 0);
  let width = Math.max(64, textWidth + 32);
  let height = Math.max(40, rows * LINE + 22);

  switch (shape) {
    case "diamond":
      width = textWidth + 72;
      height = Math.max(height + 40, 80);
      break;
    case "circle":
    case "double-circle": {
      const d = Math.max(width, height) + (shape === "double-circle" ? 12 : 0);
      width = d;
      height = d;
      break;
    }
    case "hexagon":
      width += 28;
      break;
    case "cylinder":
      height += 18;
      break;
    case "parallelogram":
    case "parallelogram-alt":
    case "trapezoid":
    case "trapezoid-alt":
      width += 32;
      break;
    case "stadium":
    case "round":
    case "subroutine":
    case "asymmetric":
      width += 16;
      break;
    default:
      break;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

const meta = (n: FlowNode) => (n.data as unknown as { mermaid: MermaidNodeMeta }).mermaid;
const parentOf = (n: FlowNode | undefined) => ((n as { parentId?: string } | undefined)?.parentId ?? null);

export function layoutMermaid(nodes: FlowNode[], edges: FlowEdge[], direction: MermaidDirection): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string | null, FlowNode[]>();
  for (const n of nodes) {
    const p = parentOf(n);
    const list = children.get(p) ?? [];
    list.push(n);
    children.set(p, list);
  }
  const size = new Map<string, Size>();
  const pos = new Map<string, { x: number; y: number }>();

  const scope = (id: string | null, dir: MermaidDirection) => {
    const kids = children.get(id) ?? [];
    for (const k of kids) {
      if (meta(k).subgraph) scope(k.id, meta(k).direction ?? dir);
      else size.set(k.id, mermaidNodeSize(String(k.data.label ?? ""), meta(k).shape));
    }

    if (kids.length === 0) {
      if (id !== null) size.set(id, { width: Math.max(160, titleWidth(byId.get(id)!)), height: TITLE + 40 });
      return;
    }

    // Project every edge onto the members of this scope it passes through.
    const inScope = new Set(kids.map((k) => k.id));
    const lift = (nodeId: string): string | null => {
      let cur: string | null = nodeId;
      // Bounded by the depth limit; the counter only guards a malformed graph.
      for (let guard = 0; cur !== null && guard < 64; guard++) {
        if (inScope.has(cur)) return cur;
        cur = parentOf(byId.get(cur));
      }
      return null;
    };
    const pairs = new Map<string, { source: string; target: string }>();
    for (const e of edges) {
      const a = lift(e.source);
      const b = lift(e.target);
      // `>` cannot occur in an imported id, so the key is unambiguous.
      if (a && b && a !== b) pairs.set(`${a}>${b}`, { source: a, target: b });
    }

    const proxy: FlowGraph = {
      nodes: kids.map((k) => ({ id: k.id, position: { x: 0, y: 0 }, data: {}, ...size.get(k.id)! }) as unknown as FlowNode),
      edges: [...pairs.values()].map((p, k) => ({ id: `p${k}`, ...p })),
    };
    const laid = autoLayout(proxy, { direction: dir as AutoLayoutDirection, nodeSep: 32, rankSep: 48 });

    const minX = Math.min(...laid.map((n) => n.position.x));
    const minY = Math.min(...laid.map((n) => n.position.y));
    const offX = (id === null ? 0 : PAD) - minX;
    const offY = (id === null ? 0 : TITLE) - minY;
    let maxX = 0;
    let maxY = 0;
    for (const n of laid) {
      const s = size.get(n.id)!;
      const p = { x: Math.round(n.position.x + offX), y: Math.round(n.position.y + offY) };
      pos.set(n.id, p);
      maxX = Math.max(maxX, p.x + s.width);
      maxY = Math.max(maxY, p.y + s.height);
    }
    if (id !== null) {
      size.set(id, { width: Math.max(maxX + PAD, titleWidth(byId.get(id)!)), height: maxY + PAD });
    }
  };

  scope(null, direction);

  return nodes.map((n) => ({
    ...n,
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    width: size.get(n.id)?.width ?? 120,
    height: size.get(n.id)?.height ?? 48,
  }));
}

function titleWidth(n: FlowNode): number {
  return Math.round(Math.min(Array.from(String(n.data.label ?? "")).length, 60) * CHAR + 2 * PAD);
}

/**
 * The extent of a laid-out graph's top level: what a viewer needs to choose a
 * height that keeps the diagram's shape.
 */
export function mermaidBounds(graph: FlowGraph): { width: number; height: number } {
  let width = 0;
  let height = 0;
  for (const n of graph.nodes as Array<FlowNode & { width?: number; height?: number; parentId?: string }>) {
    if (n.parentId) continue;
    width = Math.max(width, n.position.x + (n.width ?? 0));
    height = Math.max(height, n.position.y + (n.height ?? 0));
  }
  return { width, height };
}
