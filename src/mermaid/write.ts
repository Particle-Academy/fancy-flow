/**
 * toMermaid — a fancy-flow graph back to Mermaid flowchart source.
 *
 * Writes one canonical form: the header, then every node declared once (inside
 * its subgraph), then every edge. Labels are always quoted and escaped with
 * Mermaid's `#name;` entities, `<` and `>` included, so real Mermaid shows the
 * characters rather than rendering them as markup. Reading the output back with
 * `fromMermaid` gives the same graph.
 *
 * Works on any graph, not just an imported one: a workflow exports with its
 * node labels (or kind names) as rectangles.
 */
import { encodeLabel } from "./labels";
import type {
  MermaidDirection,
  MermaidEdgeMeta,
  MermaidEnd,
  MermaidExportOptions,
  MermaidExportResult,
  MermaidGraph,
  MermaidNodeMeta,
  MermaidShape,
} from "./types";
import type { FlowGraph, FlowNode } from "../types";

const VALID_ID = /^[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*$/u;
/** Words that start a statement; a node id written as one would be misread. */
const RESERVED = new Set([
  "end", "graph", "flowchart", "subgraph", "style", "classDef", "class", "linkStyle",
  "click", "direction", "accTitle", "accDescr",
]);

const SHAPE_DELIMS: Record<MermaidShape, [string, string]> = {
  rect: ["[", "]"],
  round: ["(", ")"],
  stadium: ["([", "])"],
  subroutine: ["[[", "]]"],
  cylinder: ["[(", ")]"],
  circle: ["((", "))"],
  "double-circle": ["(((", ")))"],
  asymmetric: [">", "]"],
  diamond: ["{", "}"],
  hexagon: ["{{", "}}"],
  parallelogram: ["[/", "/]"],
  "parallelogram-alt": ["[\\", "\\]"],
  trapezoid: ["[/", "\\]"],
  "trapezoid-alt": ["[\\", "/]"],
};

const HEAD_CHAR: Record<MermaidEnd, string> = { none: "", arrow: ">", circle: "o", cross: "x" };
const TAIL_CHAR: Record<MermaidEnd, string> = { none: "", arrow: "<", circle: "o", cross: "x" };

function safeId(id: string, taken: Set<string>): string {
  let out = id;
  if (!VALID_ID.test(out) || RESERVED.has(out)) {
    out = id
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .replace(/-{2,}/g, "_");
    // A linear trim, not /^-+|-+$/: that pattern is polynomial on hostile ids.
    // After the collapse above, an edge run of dashes is at most one character.
    if (out.startsWith("-")) out = "_" + out.slice(1);
    if (out.length > 1 && out.endsWith("-")) out = out.slice(0, -1) + "_";
    if (!out) out = "node";
    if (RESERVED.has(out)) out += "_";
  }
  if (taken.has(out)) {
    let k = 2;
    while (taken.has(`${out}_${k}`)) k++;
    out = `${out}_${k}`;
  }
  taken.add(out);
  return out;
}

function link(meta: Partial<MermaidEdgeMeta> | undefined): string {
  const stroke = meta?.stroke ?? "normal";
  const head = meta?.head ?? "arrow";
  const tail = meta?.tail ?? "none";
  const length = Math.max(1, Math.floor(meta?.length ?? 1));
  if (stroke === "invisible") return "~".repeat(length + 2);
  if (stroke === "dotted") return `${TAIL_CHAR[tail]}-${".".repeat(length)}-${HEAD_CHAR[head]}`;
  const ch = stroke === "thick" ? "=" : "-";
  if (head === "none" && tail === "none") return ch.repeat(length + 2);
  return `${TAIL_CHAR[tail]}${ch.repeat(length + 1)}${HEAD_CHAR[head]}`;
}

function nodeLabel(n: FlowNode): string {
  const data = (n.data ?? {}) as { label?: unknown; kind?: unknown };
  if (typeof data.label === "string") return data.label;
  if (typeof data.kind === "string") return data.kind;
  return n.type ?? n.id;
}

/** Write Mermaid, with a report of what could not be written as given. */
export function exportMermaid(graph: FlowGraph, options: MermaidExportOptions = {}): MermaidExportResult {
  const direction: MermaidDirection = options.direction ?? (graph as MermaidGraph).mermaid?.direction ?? "TB";
  const taken = new Set<string>();
  const ids = new Map<string, string>();
  const renamedIds: Record<string, string> = {};
  for (const n of graph.nodes) {
    const out = safeId(n.id, taken);
    ids.set(n.id, out);
    if (out !== n.id) renamedIds[n.id] = out;
  }

  const children = new Map<string | null, FlowNode[]>();
  for (const n of graph.nodes) {
    const parent = (n as { parentId?: string }).parentId;
    const key = parent && ids.has(parent) ? parent : null;
    const list = children.get(key) ?? [];
    list.push(n);
    children.set(key, list);
  }

  const lines = [`flowchart ${direction}`];
  const visiting = new Set<string>();
  const emit = (n: FlowNode, indent: string) => {
    if (visiting.has(n.id)) return; // a parentId cycle in a hand-built graph
    visiting.add(n.id);
    const id = ids.get(n.id)!;
    const label = nodeLabel(n);
    const meta = (n.data as { mermaid?: Partial<MermaidNodeMeta> } | undefined)?.mermaid;
    const kids = children.get(n.id);
    if (meta?.subgraph || kids?.length) {
      lines.push(label === id ? `${indent}subgraph ${id}` : `${indent}subgraph ${id} ["${encodeLabel(label)}"]`);
      if (meta?.direction) lines.push(`${indent}  direction ${meta.direction}`);
      for (const k of kids ?? []) emit(k, indent + "  ");
      lines.push(`${indent}end`);
      return;
    }
    const shape: MermaidShape = meta?.shape && meta.shape in SHAPE_DELIMS ? meta.shape : "rect";
    if (shape === "rect" && label === id) {
      lines.push(`${indent}${id}`);
      return;
    }
    const [open, close] = SHAPE_DELIMS[shape];
    lines.push(`${indent}${id}${open}"${encodeLabel(label)}"${close}`);
  };
  for (const n of children.get(null) ?? []) emit(n, "  ");

  const skippedEdges: string[] = [];
  for (const e of graph.edges) {
    const source = ids.get(e.source);
    const target = ids.get(e.target);
    if (!source || !target) {
      skippedEdges.push(e.id);
      continue;
    }
    const meta = (e.data as { mermaid?: Partial<MermaidEdgeMeta> } | undefined)?.mermaid;
    const label = typeof e.label === "string" || typeof e.label === "number" ? String(e.label) : "";
    const pipe = label ? `|"${encodeLabel(label, { pipe: true })}"|` : "";
    lines.push(`  ${source} ${link(meta)}${pipe} ${target}`);
  }

  return { source: lines.join("\n") + "\n", report: { skippedEdges, renamedIds } };
}

/** Write a graph as Mermaid flowchart source. See `exportMermaid` for the report. */
export function toMermaid(graph: FlowGraph, options: MermaidExportOptions = {}): string {
  return exportMermaid(graph, options).source;
}
