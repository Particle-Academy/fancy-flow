import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Edge } from "@xyflow/react";
import type { FlowGraph, FlowNode, NodeRunStatus } from "../../types";
import type { WorkflowSchema } from "../../schema";
import type { AlignEdge } from "./graph-ops";
import type { AutoLayoutOptions } from "../../layout";

/**
 * Everything the editor knows and can do, handed to every extension point.
 *
 * This is the seam that makes `<FlowEditor>` composable instead of fixed: it is
 * passed to custom actions and slots, returned from `useFlowEditor()` inside
 * any child, and exposed on the editor `ref` so a host can drive the editor
 * imperatively (or an MCP bridge can drive it for an agent).
 */
export type FlowEditorApi = {
  // ── State ────────────────────────────────────────────────────────────
  /** The current graph. */
  graph: FlowGraph;
  nodes: FlowNode[];
  edges: Edge[];
  /** Currently selected node id, or null. */
  selectedId: string | null;
  /** Currently selected node, or null. */
  selected: FlowNode | null;
  /** Currently selected edge id, or null. Independent of node selection. */
  selectedEdgeId: string | null;
  /** Currently selected edge, or null. */
  selectedEdge: Edge | null;
  /** All multi-selected node ids (xyflow box / shift selection). */
  selectedIds: string[];
  /** All multi-selected nodes. */
  selectedNodes: FlowNode[];
  /** True while a run is in flight. */
  running: boolean;
  /** Per-node run status, keyed by node id. */
  statuses: Record<string, NodeRunStatus>;

  // ── Selection ────────────────────────────────────────────────────────
  select: (id: string | null) => void;
  /** Select an edge (the connection between two nodes), or clear with null. */
  selectEdge: (id: string | null) => void;

  // ── Graph mutation ───────────────────────────────────────────────────
  /** Add a node of `kind` at an optional flow position. Returns the new id. */
  addNode: (kind: string, position?: { x: number; y: number }) => string | null;
  /** Replace one node (matched by id). */
  updateNode: (node: FlowNode) => void;
  /** Delete nodes by id, pruning every edge attached to them. */
  deleteNodes: (ids: string[]) => void;
  /** Delete the current selection (no-op when nothing is selected). */
  deleteSelected: () => void;
  /** Delete edges by id — i.e. break the connections between nodes. */
  deleteEdges: (ids: string[]) => void;
  /** Delete the selected edge (no-op when no edge is selected). */
  deleteSelectedEdge: () => void;
  /** Label a connection, or clear the label by passing undefined/"". */
  setEdgeLabel: (id: string, label: string | undefined) => void;
  /** Copy a node (offset slightly) and select the copy. Returns the new id. */
  duplicateNode: (id: string) => string | null;
  /** Replace the whole graph. */
  setGraph: (graph: FlowGraph) => void;

  // ── Bulk (multi-selection) ───────────────────────────────────────────
  /** Duplicate the current multi-selection, preserving edges between them. */
  duplicateSelected: () => void;
  /** Align the multi-selection to a shared edge/center of its bounding box. */
  alignSelected: (edge: AlignEdge) => void;
  /** Evenly distribute the multi-selection's gaps along an axis (needs 3+). */
  distributeSelected: (axis: "h" | "v") => void;

  // ── Swimlanes ────────────────────────────────────────────────────────
  /** Add a swimlane, stacked with existing lanes. Returns the new lane id. */
  addLane: (orientation?: "horizontal" | "vertical", title?: string) => string | null;
  /** Put a node inside a lane (sets parentId + a lane-relative position). */
  assignToLane: (nodeId: string, laneId: string) => void;
  /** Remove a node from its lane (restores its absolute position). */
  removeFromLane: (nodeId: string) => void;
  /** Auto-arrange the graph (or a lane's children) into a tidy DAG layout. */
  autoLayout: (options?: AutoLayoutOptions) => void;
  /** Tidy just one lane's children. */
  tidyLane: (laneId: string) => void;

  // ── Clipboard ────────────────────────────────────────────────────────
  /** Copy the current selection to the editor clipboard. */
  copy: () => void;
  /** Copy then delete the current selection. */
  cut: () => void;
  /** Paste the clipboard (optionally at a flow position) and select the result. */
  paste: (at?: { x: number; y: number }) => void;

  // ── Run ──────────────────────────────────────────────────────────────
  run: () => void;
  cancel: () => void;
  reset: () => void;

  // ── Workflow I/O ─────────────────────────────────────────────────────
  /** The current graph as a WorkflowSchema (what `export` downloads). */
  toWorkflow: () => WorkflowSchema;
  /** Download the workflow as JSON. */
  exportWorkflow: () => void;
  /** Open a file picker and load a workflow. */
  importWorkflow: () => void;

  // ── Viewport ─────────────────────────────────────────────────────────
  fitView: () => void;

  // ── History ──
  /** Undo the last committing edit (add / delete / connect / config / drag /
   *  import). Transient interactions (a drag in progress, selection) are not
   *  their own steps. */
  undo: () => void;
  /** Redo the last undone edit. */
  redo: () => void;
  /** True when there is an edit to undo. */
  canUndo: boolean;
  /** True when there is an undone edit to redo. */
  canRedo: boolean;
};

/**
 * A declarative toolbar button. JSON-friendly on purpose — a host (or an
 * agent) can describe editor affordances as data rather than JSX.
 */
export type FlowEditorAction = {
  /** Stable id — also the `data-action` handle, so agents never guess DOM. */
  id: string;
  label: ReactNode;
  /** Native tooltip. */
  title?: string;
  /** Where it sits relative to the built-in buttons. Default "end". */
  placement?: "start" | "end";
  /** Disable when this returns true. Re-evaluated on every render. */
  disabled?: (api: FlowEditorApi) => boolean;
  /** Hide entirely when this returns false. */
  visible?: (api: FlowEditorApi) => boolean;
  /** Only enabled when a node is selected. Sugar over `disabled`. */
  requiresSelection?: boolean;
  onSelect: (api: FlowEditorApi) => void;
};

/** Which built-in toolbar affordances to render. All default to true. */
export type FlowEditorBuiltins = {
  run?: boolean;
  delete?: boolean;
  /** Undo/redo toolbar buttons. Default true. */
  history?: boolean;
  /** "Add lane" toolbar button. Default true. */
  addLane?: boolean;
  /** "Tidy" (auto-layout) toolbar button. Default true. */
  autoLayout?: boolean;
  /** Right-click a node for Delete / Duplicate. Default true. */
  contextMenu?: boolean;
  /** Right-click a connection for Label / Delete. Default true. */
  edgeContextMenu?: boolean;
  export?: boolean;
  import?: boolean;
  count?: boolean;
};

/** Replaceable regions. Each receives the editor API. */
export type FlowEditorSlots = {
  /** Replace the ENTIRE toolbar (built-ins and actions are not rendered). */
  toolbar?: (api: FlowEditorApi) => ReactNode;
  /** Replace the left palette. */
  palette?: (api: FlowEditorApi) => ReactNode;
  /** Replace the right config panel. */
  panel?: (api: FlowEditorApi) => ReactNode;
  /** Appended inside the config panel, under the fields — per-node actions. */
  panelFooter?: (api: FlowEditorApi) => ReactNode;
  /** Replace the run feed. */
  feed?: (api: FlowEditorApi) => ReactNode;
  /** Rendered over the canvas when the graph is empty. */
  empty?: (api: FlowEditorApi) => ReactNode;
  /** Replace the node right-click menu. Receives the right-clicked node id;
   *  call `close` when an item is chosen. */
  contextMenu?: (api: FlowEditorApi, nodeId: string, close: () => void) => ReactNode;
  /** Replace the connection right-click menu. Receives the right-clicked edge
   *  id; call `close` when an item is chosen. */
  edgeContextMenu?: (api: FlowEditorApi, edgeId: string, close: () => void) => ReactNode;
};

const FlowEditorContext = createContext<FlowEditorApi | null>(null);

export const FlowEditorProvider = FlowEditorContext.Provider;

/**
 * Read the editor API from any child of `<FlowEditor>`. Throws outside one, so
 * a misplaced custom control fails loudly instead of silently doing nothing.
 */
export function useFlowEditor(): FlowEditorApi {
  const api = useContext(FlowEditorContext);
  if (api === null) {
    throw new Error("useFlowEditor() must be called inside <FlowEditor>.");
  }
  return api;
}

/** Non-throwing variant, for components that may render outside an editor. */
export function useFlowEditorOptional(): FlowEditorApi | null {
  return useContext(FlowEditorContext);
}
