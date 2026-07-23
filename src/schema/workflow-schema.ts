import type { FlowEdge, FlowGraph, FlowNode, PortDescriptor } from "../types";
import { defaultConfigFor, getNodeKind, validateConfig } from "../registry/registry";
import { resolveNodePorts } from "../registry/ports";

/** Schema version. Bump on breaking shape changes; add migrations as needed. */
export const WORKFLOW_SCHEMA_VERSION = 1 as const;
export const WORKFLOW_SCHEMA_URL = "https://particle.academy/schemas/workflow/v1.json";

export type WorkflowSchema = {
  $schema: typeof WORKFLOW_SCHEMA_URL;
  version: typeof WORKFLOW_SCHEMA_VERSION;
  metadata?: WorkflowMetadata;
  graph: {
    nodes: WorkflowSchemaNode[];
    edges: WorkflowSchemaEdge[];
  };
  view?: {
    viewport?: { x: number; y: number; zoom: number };
  };
};

export type WorkflowMetadata = {
  id?: string;
  name?: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
  author?: string;
  tags?: string[];
};

export type WorkflowSchemaNode = {
  id: string;
  /** Registry kind name (e.g. "memory_store"). */
  kind: string;
  position: { x: number; y: number };
  label?: string;
  description?: string;
  config?: Record<string, unknown>;
  /**
   * Resolved ports, written on export.
   *
   * A kind may derive its ports from config (`switch_case` cases,
   * `llm_branch` routes), and that derivation is a JavaScript function — a
   * runtime in another language cannot execute it. Without the resolved ports
   * in the document, the PHP twin sees no declared outputs and falls back to a
   * single `out`, so every branch edge in an exported flow silently stops
   * firing. Serializing them keeps the schema self-describing and preserves
   * the cross-runtime guarantee: same JSON in, same routing out.
   *
   * Optional and additive — a hand-written schema may omit them, and each
   * runtime then falls back to its own kind registry.
   */
  inputs?: PortDescriptor[];
  outputs?: PortDescriptor[];
  /**
   * Visual layout — additive + optional. `parentId`/`extent` carry node grouping
   * (swimlanes / containers); `width`/`height` carry an explicit (resized) size;
   * `style` carries inline presentation. A runtime that only walks edges/ports
   * (e.g. the PHP twin) ignores all of these — they exist purely for the canvas,
   * so an older reader that doesn't know them simply drops them.
   */
  parentId?: string;
  extent?: "parent" | [[number, number], [number, number]];
  width?: number;
  height?: number;
  style?: Record<string, unknown>;
};

export type WorkflowSchemaEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
};

export type ImportIssue = {
  level: "error" | "warning";
  nodeId?: string;
  edgeId?: string;
  message: string;
};

export type ImportResult = {
  graph: FlowGraph;
  issues: ImportIssue[];
  /** True when the import produced a usable graph (errors may have been
   *  rewritten to warnings via `lenient: true`). */
  ok: boolean;
};

/** Snapshot the in-memory graph as a portable WorkflowSchema. */
export function exportWorkflow(
  graph: FlowGraph,
  metadata?: WorkflowMetadata,
  view?: WorkflowSchema["view"],
): WorkflowSchema {
  return {
    $schema: WORKFLOW_SCHEMA_URL,
    version: WORKFLOW_SCHEMA_VERSION,
    metadata: metadata ? { ...metadata, updatedAt: Date.now() } : undefined,
    graph: {
      nodes: graph.nodes.map(toSchemaNode),
      edges: graph.edges.map(toSchemaEdge),
    },
    view,
  };
}

function toSchemaNode(n: FlowNode): WorkflowSchemaNode {
  const data: any = n.data ?? {};
  const kindName = data.kind ?? n.type ?? "custom";
  // Resolve through the same helper the canvas and runtime use, so a
  // config-driven kind writes its ACTUAL ports into the document instead of
  // leaving another language's runtime to guess at them.
  const ports = resolveNodePorts(n, getNodeKind(kindName) ?? undefined);
  const node = n as any;
  return {
    id: n.id,
    kind: kindName,
    position: { x: n.position.x, y: n.position.y },
    label: data.label,
    description: data.description,
    config: data.config,
    inputs: ports.inputs,
    outputs: ports.outputs,
    // Visual layout — only when explicitly set (never persist auto-`measured`
    // dimensions, which are derived, not authored).
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ...(node.extent ? { extent: node.extent } : {}),
    ...(typeof node.width === "number" ? { width: node.width } : {}),
    ...(typeof node.height === "number" ? { height: node.height } : {}),
    ...(node.style ? { style: node.style } : {}),
  };
}

function toSchemaEdge(e: FlowEdge): WorkflowSchemaEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    label: typeof e.label === "string" ? e.label : undefined,
  };
}

export type ImportOptions = {
  /** When true, unknown kinds become warnings + a "custom" placeholder
   *  instead of errors. Default false. */
  lenient?: boolean;
};

/**
 * Migrate a raw schema object up to the current version. Additive changes need
 * no migration (an older document simply lacks the newer optional fields); this
 * is the seam for a future BREAKING bump — add `case N → N+1` steps here and
 * `importWorkflow` runs them before validating the version.
 */
export function migrateSchema(schema: unknown): unknown {
  // v1 is current — nothing to migrate yet.
  return schema;
}

/**
 * Hydrate a schema into runtime FlowGraph + validate kinds/configs against
 * the registry. Reports issues for unknown kinds, missing required config,
 * and dangling edges.
 */
export function importWorkflow(schema: unknown, options: ImportOptions = {}): ImportResult {
  const issues: ImportIssue[] = [];
  const lenient = options.lenient === true;
  schema = migrateSchema(schema);

  if (!schema || typeof schema !== "object") {
    return { ok: false, graph: { nodes: [], edges: [] }, issues: [{ level: "error", message: "Schema is not an object." }] };
  }
  const s = schema as Partial<WorkflowSchema>;
  if (s.version !== WORKFLOW_SCHEMA_VERSION) {
    issues.push({
      level: lenient ? "warning" : "error",
      message: `Unsupported workflow schema version: ${s.version} (expected ${WORKFLOW_SCHEMA_VERSION})`,
    });
    if (!lenient) return { ok: false, graph: { nodes: [], edges: [] }, issues };
  }

  const rawNodes = s.graph?.nodes ?? [];
  const rawEdges = s.graph?.edges ?? [];

  const nodes: FlowNode[] = rawNodes.map((n) => {
    const kind = getNodeKind(n.kind);
    if (!kind) {
      issues.push({
        level: lenient ? "warning" : "error",
        nodeId: n.id,
        message: `Unknown kind "${n.kind}" — register it before importing.`,
      });
    }
    const config = n.config ?? (kind ? defaultConfigFor(kind) : {});
    if (kind) {
      for (const iss of validateConfig(kind, config)) {
        issues.push({ level: "warning", nodeId: n.id, message: `${iss.key}: ${iss.message}` });
      }
    }
    // Canonicalise on the way in: a document may carry a pre-namespace id, and
    // rewriting it here means the graph converges on the canonical id the next
    // time it is saved, rather than carrying the ambiguous name forever.
    const kindId = kind?.name ?? n.kind;
    return {
      id: n.id,
      type: kindId,
      position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      // Rehydrate visual layout onto the node's top level (where xyflow reads it).
      ...(n.parentId ? { parentId: n.parentId } : {}),
      ...(n.extent ? { extent: n.extent } : {}),
      ...(typeof n.width === "number" ? { width: n.width } : {}),
      ...(typeof n.height === "number" ? { height: n.height } : {}),
      ...(n.style ? { style: n.style } : {}),
      data: {
        kind: kindId,
        label: n.label ?? kind?.label ?? n.kind,
        description: n.description,
        config,
        // Carry serialized ports back onto the node so a round-trip is stable
        // and an unknown kind still routes the way the document described.
        ...(n.inputs ? { inputs: n.inputs } : {}),
        ...(n.outputs ? { outputs: n.outputs } : {}),
      } as any,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: FlowEdge[] = rawEdges
    .map((e) => {
      if (!nodeIds.has(e.source)) {
        issues.push({ level: "warning", edgeId: e.id, message: `Edge source "${e.source}" not found.` });
        return null;
      }
      if (!nodeIds.has(e.target)) {
        issues.push({ level: "warning", edgeId: e.id, message: `Edge target "${e.target}" not found.` });
        return null;
      }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: e.label,
      } as FlowEdge;
    })
    .filter((e): e is FlowEdge => e !== null);

  const ok = issues.every((i) => i.level !== "error");
  return { ok, graph: { nodes, edges }, issues };
}

/** Convenience: serialize a schema as a downloadable JSON Blob. */
export function workflowToBlob(schema: WorkflowSchema): Blob {
  return new Blob([JSON.stringify(schema, null, 2)], { type: "application/json" });
}
