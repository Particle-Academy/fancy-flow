import type { FlowEdge, FlowGraph, FlowNode } from "../types";
import { defaultConfigFor, getNodeKind, validateConfig } from "../registry/registry";

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
  return {
    id: n.id,
    kind: data.kind ?? n.type ?? "custom",
    position: { x: n.position.x, y: n.position.y },
    label: data.label,
    description: data.description,
    config: data.config,
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
 * Hydrate a schema into runtime FlowGraph + validate kinds/configs against
 * the registry. Reports issues for unknown kinds, missing required config,
 * and dangling edges.
 */
export function importWorkflow(schema: unknown, options: ImportOptions = {}): ImportResult {
  const issues: ImportIssue[] = [];
  const lenient = options.lenient === true;

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
    return {
      id: n.id,
      type: n.kind,
      position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      data: {
        kind: n.kind,
        label: n.label ?? kind?.label ?? n.kind,
        description: n.description,
        config,
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
