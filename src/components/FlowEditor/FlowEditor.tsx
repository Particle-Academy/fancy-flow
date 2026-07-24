import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ReactFlowProvider,
  useReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import type { UseFlowStateReturn } from "../../runtime/use-flow-state";
import { FlowCanvas, type FlowCanvasProps } from "../canvas/FlowCanvas";
import { NodePalette, paletteDropHandlers } from "../NodePalette";
import { NodeConfigPanel } from "../NodeConfigPanel";
import { FlowRunControls } from "../FlowRunControls";
import { FlowRunFeed } from "../FlowRunFeed";
import { useFlowState } from "../../runtime/use-flow-state";
import { useFlowHistory } from "../../runtime/use-flow-history";
import { useFlowRun, applyStatusesToNodes } from "../../runtime/use-flow-run";
import { exportWorkflow, importWorkflow, workflowToBlob, type WorkflowMetadata, type WorkflowSchema } from "../../schema";
import { buildNodeTypes, defaultConfigFor, getNodeKind, listNodeKinds, onNodeKindsChanged } from "../../registry";
import type { ExecutorRegistry, FlowGraph, FlowNode } from "../../types";
import {
  duplicateNode as cloneNode,
  cloneSubgraph,
  reconnectEdge,
  alignNodes,
  distributeNodes,
  assignToLane as assignToLaneOp,
  removeFromLane as removeFromLaneOp,
  removeEdges,
  removeNodes,
  setEdgeLabel,
  type AlignEdge,
} from "./graph-ops";
import {
  FlowEditorProvider,
  type FlowEditorAction,
  type FlowEditorApi,
  type FlowEditorBuiltins,
  type FlowEditorSlots,
} from "./api";

export type FlowEditorProps = {
  initial?: FlowGraph;
  /** Controlled mode — host owns the graph state. When set, takes precedence
   *  over `initial`. Pair with `onChange` to receive edits. */
  value?: FlowGraph;
  /** Executor registry passed to runFlow. Each kind name maps to an executor. */
  executors?: ExecutorRegistry;
  /** Saved metadata for export. */
  metadata?: WorkflowMetadata;
  /** Show the palette sidebar. Default true. */
  showPalette?: boolean;
  /** Show the config panel sidebar. Default true. */
  showPanel?: boolean;
  /** Show run feed below the canvas. Default true. */
  showFeed?: boolean;
  /** Total editor height. Default 720. */
  height?: number;
  /** Extra toolbar content, appended after the built-ins. Prefer `actions`
   *  (declarative + agent-emittable); this stays for back-compat. */
  extraToolbar?: ReactNode;
  /** Declarative custom toolbar buttons. */
  actions?: FlowEditorAction[];
  /** Turn built-in toolbar affordances off individually. */
  builtins?: FlowEditorBuiltins;
  /** Replace whole regions of the editor. */
  slots?: FlowEditorSlots;
  /** Forwarded to `<FlowCanvas>` / React Flow — snapToGrid, minimap, context
   *  menus, edge types, and anything else xyflow accepts. */
  canvasProps?: Partial<Omit<FlowCanvasProps, "nodes" | "edges">>;
  /** Called whenever the graph changes — host can persist. */
  onChange?: (graph: FlowGraph) => void;
  /** Called when the selected node changes. */
  onSelectionChange?: (node: FlowNode | null) => void;
  /** Called after nodes are deleted, with the deleted ids. */
  onDelete?: (ids: string[]) => void;
  /** Called after connections are broken, with the deleted edge ids. */
  onEdgeDelete?: (ids: string[]) => void;
  /**
   * Stage destructive edits for human confirmation. When set, every delete path
   * — keyboard, panel, context menu, and `api.deleteNodes`/`deleteEdges` —
   * calls this first; return false to veto. Default: delete immediately. This
   * realizes the component contract's "agents propose, humans confirm" on the
   * canvas.
   */
  confirmDelete?: (targets: { nodes: FlowNode[]; edges: Edge[] }) => boolean | Promise<boolean>;
  className?: string;
  style?: CSSProperties;
};

/**
 * FlowEditor — batteries-included workflow editor, but not a black box.
 *
 * Defaults compose NodePalette + FlowCanvas + NodeConfigPanel + run controls +
 * feed. Every part is replaceable: pass `actions` for custom toolbar buttons,
 * `slots` to swap a whole region, `canvasProps` to reach React Flow, or grab
 * the {@link FlowEditorApi} from `ref` / `useFlowEditor()` and build your own
 * chrome around the primitives.
 */
export const FlowEditor = forwardRef<FlowEditorApi, FlowEditorProps>(function FlowEditor(props, ref) {
  return (
    <ReactFlowProvider>
      <div
        className={["ff-editor", props.className ?? ""].filter(Boolean).join(" ")}
        style={{ height: props.height ?? 720, ...props.style }}
      >
        <FlowEditorInner {...props} apiRef={ref} />
      </div>
    </ReactFlowProvider>
  );
});

function FlowEditorInner({
  initial = { nodes: [], edges: [] },
  value,
  executors = {},
  metadata,
  showPalette = true,
  showPanel = true,
  showFeed = true,
  extraToolbar,
  actions = [],
  builtins = {},
  slots = {},
  canvasProps = {},
  onChange,
  onSelectionChange,
  onDelete,
  onEdgeDelete,
  confirmDelete,
  apiRef,
}: FlowEditorProps & { apiRef?: React.ForwardedRef<FlowEditorApi> }) {
  const internal = useFlowState(initial);
  const runner = useFlowRun();
  const rf = useReactFlow();

  // When `value` is provided we run in controlled mode: host owns nodes/edges,
  // local edits go through onChange. Internal state is unused but the hook
  // still has to run (rules of hooks).
  const controlled = value !== undefined;
  const baseFlow = controlled ? makeControlledFlowAdapter(value!, onChange) : internal;
  // Wrap the sink with the commit/undo pipeline — one interception point for
  // every committing mutation, whichever mode we're in.
  const hist = useFlowHistory(baseFlow);
  const flow = hist.flow;

  // Re-render when registry kinds change so the palette + nodeTypes reflect it.
  const [, force] = useState(0);
  useEffect(() => onNodeKindsChanged(() => force((n) => n + 1)), []);
  const nodeTypes = useMemo(() => buildNodeTypes(), [listNodeKinds().length]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderedNodes = useMemo(
    () => applyStatusesToNodes(flow.nodes, runner.statuses, runner.statusText),
    [flow.nodes, runner.statuses, runner.statusText],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => flow.nodes.find((n) => n.id === selectedId) ?? null, [flow.nodes, selectedId]);

  useEffect(() => onSelectionChange?.(selected), [selected, onSelectionChange]);

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const selectedEdge = useMemo(
    () => flow.edges.find((e: Edge) => e.id === selectedEdgeId) ?? null,
    [flow.edges, selectedEdgeId],
  );

  const handleNodeClick: NodeMouseHandler = (_e, node) => {
    setSelectedId(node.id);
    // Node and edge selection are mutually exclusive, so Delete is never
    // ambiguous about what it would remove.
    setSelectedEdgeId(null);
  };

  // Right-click menu, for a node OR a connection. Anchored in viewport coords
  // (position: fixed), so it is not clipped by the canvas' overflow.
  const [menu, setMenu] = useState<
    { x: number; y: number; target: { type: "node" | "edge"; id: string } } | null
  >(null);
  // Inline "label this connection" editor, anchored like the menu.
  const [labelEdit, setLabelEdit] = useState<{ x: number; y: number; edgeId: string } | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const handleNodeContextMenu: NodeMouseHandler = (event, node) => {
    event.preventDefault();
    setSelectedId(node.id);
    setSelectedEdgeId(null);
    setMenu({ x: event.clientX, y: event.clientY, target: { type: "node", id: node.id } });
  };

  const handleEdgeClick = (_e: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeId(edge.id);
  };

  const handleEdgeContextMenu = (event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    setSelectedEdgeId(edge.id);
    setMenu({ x: event.clientX, y: event.clientY, target: { type: "edge", id: edge.id } });
  };

  // Dismiss on any outside click, scroll, or Escape.
  useEffect(() => {
    if (menu === null && labelEdit === null) return;
    const close = () => { setMenu(null); setLabelEdit(null); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, labelEdit]);

  // Editor keyboard shortcuts. Ignored while a field is focused, so Ctrl+Z does
  // native text-undo inside inputs/textareas rather than reverting the graph.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        hist.undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        hist.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hist]);

  // Uncontrolled: notify host on every graph mutation. Controlled mode
  // already notifies via the adapter on each setNodes/setEdges call.
  useEffect(() => {
    if (!controlled) onChange?.({ nodes: flow.nodes, edges: flow.edges });
  }, [flow.nodes, flow.edges, onChange, controlled]);

  const addNode = useCallback(
    (kindName: string, position?: { x: number; y: number }): string | null => {
      const kind = getNodeKind(kindName);
      if (!kind) return null;
      const at = position ?? { x: 80, y: 80 };
      const id = newNodeId();
      flow.setNodes((all: FlowNode[]) => [
        ...all,
        {
          id,
          type: kind.name,
          position: at,
          data: { kind: kind.name, label: kind.label, config: defaultConfigFor(kind) } as any,
        } as FlowNode,
      ]);
      setSelectedId(id);
      return id;
    },
    [flow],
  );

  /** Delete nodes AND every edge attached to them — an orphaned edge would
   *  otherwise survive the node it connected. */
  const deleteNodes = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const targets = flow.nodes.filter((n) => ids.includes(n.id));
      if (targets.length === 0) return;
      if (confirmDelete) {
        const attached = flow.edges.filter((e: Edge) => ids.includes(e.source) || ids.includes(e.target));
        if (!(await confirmDelete({ nodes: targets, edges: attached }))) return;
      }
      const doomed = new Set(ids);
      // Atomic: prune edges + remove nodes in ONE commit — one undo step, and
      // correct in controlled mode where two sequential writes would clobber.
      flow.setGraph(removeNodes({ nodes: flow.nodes, edges: flow.edges }, ids));
      setSelectedId((cur) => (cur !== null && doomed.has(cur) ? null : cur));
      onDelete?.(ids);
    },
    [flow, onDelete, confirmDelete],
  );

  const deleteEdges = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const targets = flow.edges.filter((e: Edge) => ids.includes(e.id));
      if (targets.length === 0) return;
      if (confirmDelete && !(await confirmDelete({ nodes: [], edges: targets }))) return;
      flow.setEdges((all: Edge[]) => removeEdges(all, ids));
      setSelectedEdgeId((cur) => (cur !== null && ids.includes(cur) ? null : cur));
      onEdgeDelete?.(ids);
    },
    [flow, onEdgeDelete, confirmDelete],
  );

  // ── Multi-selection + clipboard (Release 2) ──
  // xyflow owns the real multi-selection (box / shift-click) on `node.selected`;
  // we read it rather than tracking a parallel list.
  const selectedNodes = useMemo(() => flow.nodes.filter((n) => n.selected), [flow.nodes]);
  const selectedIds = useMemo(() => selectedNodes.map((n) => n.id), [selectedNodes]);

  const clipboard = useRef<FlowGraph | null>(null);

  const copySelection = useCallback(() => {
    const sel = flow.nodes.filter((n) => n.selected);
    if (sel.length === 0) return;
    const ids = new Set(sel.map((n) => n.id));
    const edges = flow.edges.filter((e: Edge) => ids.has(e.source) && ids.has(e.target));
    clipboard.current = { nodes: sel.map((n) => ({ ...n })), edges: edges.map((e) => ({ ...e })) };
  }, [flow]);

  const pasteClipboard = useCallback(
    (at?: { x: number; y: number }) => {
      const clip = clipboard.current;
      if (!clip || clip.nodes.length === 0) return;
      const { nodes: clones, edges: cloneEdges } = cloneSubgraph(clip.nodes, clip.edges, { makeId: newNodeId, offset: 40 });
      let placed = clones;
      if (at) {
        const minX = Math.min(...clones.map((n) => n.position.x));
        const minY = Math.min(...clones.map((n) => n.position.y));
        placed = clones.map((n) => ({ ...n, position: { x: n.position.x - minX + at.x, y: n.position.y - minY + at.y } }));
      }
      flow.setGraph({
        nodes: [...flow.nodes.map((n) => ({ ...n, selected: false })), ...placed.map((n) => ({ ...n, selected: true }))],
        edges: [...flow.edges, ...cloneEdges],
      });
    },
    [flow],
  );

  const duplicateSelected = useCallback(() => {
    const sel = flow.nodes.filter((n) => n.selected);
    if (sel.length === 0) return;
    const ids = new Set(sel.map((n) => n.id));
    const internal = flow.edges.filter((e: Edge) => ids.has(e.source) && ids.has(e.target));
    const { nodes: clones, edges: cloneEdges } = cloneSubgraph(sel, internal, { makeId: newNodeId, offset: 40 });
    flow.setGraph({
      nodes: [...flow.nodes.map((n) => ({ ...n, selected: false })), ...clones.map((n) => ({ ...n, selected: true }))],
      edges: [...flow.edges, ...cloneEdges],
    });
  }, [flow]);

  const alignSelected = useCallback(
    (edge: AlignEdge) => {
      const sel = flow.nodes.filter((n) => n.selected);
      if (sel.length < 2) return;
      const byId = new Map(alignNodes(sel, edge).map((n) => [n.id, n] as const));
      flow.setNodes((all: FlowNode[]) => all.map((n) => byId.get(n.id) ?? n));
    },
    [flow],
  );

  const distributeSelected = useCallback(
    (axis: "h" | "v") => {
      const sel = flow.nodes.filter((n) => n.selected);
      if (sel.length < 3) return;
      const byId = new Map(distributeNodes(sel, axis).map((n) => [n.id, n] as const));
      flow.setNodes((all: FlowNode[]) => all.map((n) => byId.get(n.id) ?? n));
    },
    [flow],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, conn: Connection) => flow.setEdges((eds: Edge[]) => reconnectEdge(eds, oldEdge, conn)),
    [flow],
  );

  // ── Swimlanes (Release 4) ──
  const isLaneNode = useCallback(
    (n: FlowNode) => getNodeKind((n.data as any)?.kind ?? n.type)?.category === "layout",
    [],
  );

  const addLane = useCallback(
    (orientation: "horizontal" | "vertical" = "horizontal", title?: string): string => {
      const vertical = orientation === "vertical";
      const lanes = flow.nodes.filter(isLaneNode);
      const w = vertical ? 280 : 680;
      const h = vertical ? 480 : 168;
      const end = lanes.reduce(
        (m, l) =>
          Math.max(m, vertical ? l.position.x + ((l as any).width ?? w) : l.position.y + ((l as any).height ?? h)),
        0,
      );
      const id = newNodeId();
      const name = title ?? `Lane ${lanes.length + 1}`;
      const node = {
        id,
        type: "@particle-academy/lane",
        position: vertical ? { x: lanes.length ? end + 12 : 0, y: 0 } : { x: 0, y: lanes.length ? end + 12 : 0 },
        width: w,
        height: h,
        data: { kind: "@particle-academy/lane", label: name, config: { title: name, orientation } } as any,
      } as FlowNode;
      flow.setNodes((all: FlowNode[]) => [...all, node]);
      setSelectedId(id);
      return id;
    },
    [flow, isLaneNode],
  );

  // Drop a node onto a lane to file it there; drag it out to unfile it.
  const handleNodeDragStop = useCallback(
    (_e: MouseEvent | TouchEvent, node: FlowNode) => {
      if (isLaneNode(node)) return; // v1: lanes don't nest inside lanes
      const overLane = rf.getIntersectingNodes(node).find((n) => isLaneNode(n as FlowNode));
      const currentParent = (node as any).parentId as string | undefined;
      if (overLane && overLane.id !== currentParent) {
        flow.setNodes((all: FlowNode[]) => assignToLaneOp(all, node.id, overLane.id));
      } else if (!overLane && currentParent) {
        flow.setNodes((all: FlowNode[]) => removeFromLaneOp(all, node.id));
      }
    },
    [rf, flow, isLaneNode],
  );

  // Clipboard + duplicate shortcuts. (Undo/redo live in the effect above.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "c") copySelection();
      else if (key === "x") {
        e.preventDefault();
        copySelection();
        deleteNodes(selectedIds);
      } else if (key === "v") {
        e.preventDefault();
        pasteClipboard();
      } else if (key === "d") {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, pasteClipboard, duplicateSelected, deleteNodes, selectedIds]);

  const api: FlowEditorApi = useMemo(() => {
    const toWorkflow = () => exportWorkflow({ nodes: flow.nodes, edges: flow.edges }, metadata);

    return {
      graph: { nodes: flow.nodes, edges: flow.edges },
      nodes: flow.nodes,
      edges: flow.edges,
      selectedId,
      selected,
      selectedEdgeId,
      selectedEdge,
      selectedIds,
      selectedNodes,
      running: runner.running,
      statuses: runner.statuses,

      select: setSelectedId,
      selectEdge: setSelectedEdgeId,

      addNode,
      updateNode: (next) => flow.setNodes((all: FlowNode[]) => all.map((x) => (x.id === next.id ? next : x))),
      deleteNodes,
      deleteSelected: () => deleteNodes(selectedId ? [selectedId] : []),
      deleteEdges,
      deleteSelectedEdge: () => deleteEdges(selectedEdgeId ? [selectedEdgeId] : []),
      setEdgeLabel: (id, label) => flow.setEdges((all: Edge[]) => setEdgeLabel(all, id, label)),
      duplicateNode: (id) => {
        const src = flow.nodes.find((n) => n.id === id);
        if (!src) return null;
        const copy = cloneNode(src, newNodeId());
        flow.setNodes((all: FlowNode[]) => [...all, copy]);
        setSelectedId(copy.id);
        return copy.id;
      },
      setGraph: (graph) => flow.setGraph(graph),

      duplicateSelected,
      alignSelected,
      distributeSelected,
      copy: copySelection,
      cut: () => {
        copySelection();
        deleteNodes(selectedIds);
      },
      paste: pasteClipboard,

      addLane,
      assignToLane: (nodeId, laneId) => flow.setNodes((all: FlowNode[]) => assignToLaneOp(all, nodeId, laneId)),
      removeFromLane: (nodeId) => flow.setNodes((all: FlowNode[]) => removeFromLaneOp(all, nodeId)),

      run: () => runner.run({ nodes: flow.nodes, edges: flow.edges }, executors),
      cancel: runner.cancel,
      reset: runner.reset,

      toWorkflow,
      exportWorkflow: () => downloadWorkflow(toWorkflow(), metadata),
      importWorkflow: () => pickWorkflow((graph) => flow.setGraph(graph)),

      fitView: () => rf.fitView({ padding: 0.2 }),

      undo: hist.undo,
      redo: hist.redo,
      canUndo: hist.canUndo,
      canRedo: hist.canRedo,
    };
  }, [flow, selectedId, selected, selectedEdgeId, selectedEdge, selectedIds, selectedNodes, runner, executors, metadata, addNode, deleteNodes, deleteEdges, duplicateSelected, alignSelected, distributeSelected, copySelection, pasteClipboard, addLane, hist, rf]);

  useImperativeHandle(apiRef, () => api, [api]);

  const dropHandlers = paletteDropHandlers((kindName, evt) => {
    const point = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
    addNode(kindName, { x: point.x - 100, y: point.y - 30 });
  });

  const startActions = actions.filter((a) => a.placement === "start");
  const endActions = actions.filter((a) => a.placement !== "start");

  const toolbar = slots.toolbar ? (
    slots.toolbar(api)
  ) : (
    <>
      {startActions.map((a) => renderAction(a, api))}
      {builtins.run !== false && (
        <FlowRunControls running={api.running} onRun={api.run} onCancel={api.cancel} onReset={api.reset} />
      )}
      {builtins.history !== false && (
        <>
          <span className="ff-editor__sep" />
          <button
            className="ff-editor__btn"
            data-action="undo"
            title="Undo (Ctrl+Z)"
            disabled={!api.canUndo}
            onClick={api.undo}
          >
            ↶ Undo
          </button>
          <button
            className="ff-editor__btn"
            data-action="redo"
            title="Redo (Ctrl+Shift+Z)"
            disabled={!api.canRedo}
            onClick={api.redo}
          >
            ↷ Redo
          </button>
        </>
      )}
      {builtins.addLane !== false && (
        <>
          <span className="ff-editor__sep" />
          <button className="ff-editor__btn" data-action="add-lane" title="Add a swimlane" onClick={() => api.addLane()}>
            ▤ Lane
          </button>
        </>
      )}
      {(builtins.export !== false || builtins.import !== false) && (
        <span className="ff-editor__sep" />
      )}
      {/* Node deletion is not a toolbar button — it lives in NodeConfigPanel
          (see below), so the affordance is a property of the reusable panel
          rather than duplicated chrome that drifts. Keyboard Del/Backspace and
          the right-click menu still delete. `builtins.delete` gates the panel
          button. */}
      {builtins.export !== false && (
        <button className="ff-editor__btn" data-action="export" onClick={api.exportWorkflow}>↓ Export</button>
      )}
      {builtins.import !== false && (
        <button className="ff-editor__btn" data-action="import" onClick={api.importWorkflow}>↑ Import</button>
      )}
      {endActions.map((a) => renderAction(a, api))}
      {extraToolbar}
      {builtins.count !== false && (
        <span className="ff-editor__count">{api.nodes.length} nodes · {api.edges.length} edges</span>
      )}
    </>
  );

  return (
    <FlowEditorProvider value={api}>
      {showPalette && (slots.palette ? slots.palette(api) : <NodePalette className="ff-editor__palette" />)}
      <div className="ff-editor__main" {...dropHandlers}>
        <FlowCanvas
          nodes={renderedNodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          onNodesChange={flow.onNodesChange}
          onEdgesChange={flow.onEdgesChange}
          onConnect={flow.onConnect}
          // Drag an edge endpoint to rewire it; the new endpoint is validated by
          // the same isValidConnection rule (G2), so a bad reconnect is refused.
          onReconnect={onReconnect}
          edgesReconnectable
          // Snapshot the pre-drag graph once so a drag is a single undo step.
          onNodeDragStart={hist.onNodeDragStart}
          // Drop a node onto a lane to file it there (or drag it out to unfile).
          onNodeDragStop={handleNodeDragStop}
          onNodeClick={handleNodeClick}
          onNodeContextMenu={builtins.contextMenu === false ? undefined : handleNodeContextMenu}
          onEdgeClick={handleEdgeClick}
          onEdgeContextMenu={builtins.edgeContextMenu === false ? undefined : handleEdgeContextMenu}
          onEdgesDelete={(deleted: Edge[]) => onEdgeDelete?.(deleted.map((e) => e.id))}
          onNodesDelete={(deleted) => onDelete?.(deleted.map((n) => n.id))}
          // Stage the native (keyboard) delete path when a confirm gate is wired.
          onBeforeDelete={
            confirmDelete
              ? async ({ nodes, edges }) => confirmDelete({ nodes: nodes as FlowNode[], edges })
              : undefined
          }
          // Both keys delete, so muscle memory from either platform works.
          deleteKeyCode={["Delete", "Backspace"]}
          height="100%"
          toolbar={toolbar}
          {...canvasProps}
        />
        {slots.empty && api.nodes.length === 0 && (
          <div className="ff-editor__empty">{slots.empty(api)}</div>
        )}
        {menu?.target.type === "node" && builtins.contextMenu !== false && (
          <div
            className="ff-editor__ctx"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
            // Keep the outside-click listener from closing us before the click lands.
            onClick={(e) => e.stopPropagation()}
          >
            {slots.contextMenu ? (
              slots.contextMenu(api, menu.target.id, closeMenu)
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="ff-editor__ctx-item"
                  data-action="ctx-duplicate"
                  onClick={() => { api.duplicateNode(menu.target.id); closeMenu(); }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ff-editor__ctx-item ff-editor__ctx-item--danger"
                  data-action="ctx-delete"
                  onClick={() => { api.deleteNodes([menu.target.id]); closeMenu(); }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}

        {menu?.target.type === "edge" && builtins.edgeContextMenu !== false && (
          <div
            className="ff-editor__ctx"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            {slots.edgeContextMenu ? (
              slots.edgeContextMenu(api, menu.target.id, closeMenu)
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="ff-editor__ctx-item"
                  data-action="ctx-edge-label"
                  onClick={() => {
                    setLabelEdit({ x: menu.x, y: menu.y, edgeId: menu.target.id });
                    setMenu(null);
                  }}
                >
                  Label…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ff-editor__ctx-item ff-editor__ctx-item--danger"
                  data-action="ctx-edge-delete"
                  onClick={() => { api.deleteEdges([menu.target.id]); closeMenu(); }}
                >
                  Delete connection
                </button>
              </>
            )}
          </div>
        )}

        {labelEdit !== null && (
          <EdgeLabelEditor
            x={labelEdit.x}
            y={labelEdit.y}
            initial={
              (flow.edges.find((e: Edge) => e.id === labelEdit.edgeId)?.label as string | undefined) ?? ""
            }
            onCommit={(text) => {
              api.setEdgeLabel(labelEdit.edgeId, text);
              setLabelEdit(null);
            }}
            onCancel={() => setLabelEdit(null)}
          />
        )}
        {showFeed &&
          (slots.feed ? slots.feed(api) : <FlowRunFeed entries={runner.feed} className="ff-editor__feed" />)}
      </div>
      {showPanel &&
        (slots.panel ? (
          slots.panel(api)
        ) : (
          <div className="ff-editor__panel-wrap">
            <NodeConfigPanel
              className="ff-editor__panel"
              node={api.selected}
              onChange={api.updateNode}
              // The delete affordance lives IN the panel (one source of truth),
              // not a private FlowEditor toolbar button — so a dev composing
              // their own editor from NodeConfigPanel gets it for free.
              onDelete={builtins.delete === false ? undefined : (n) => api.deleteNodes([n.id])}
            />
            {slots.panelFooter && <div className="ff-editor__panel-footer">{slots.panelFooter(api)}</div>}
          </div>
        ))}
    </FlowEditorProvider>
  );
}

function renderAction(action: FlowEditorAction, api: FlowEditorApi) {
  if (action.visible && !action.visible(api)) return null;
  const disabled = action.disabled ? action.disabled(api) : action.requiresSelection === true && api.selected === null;
  return (
    <button
      key={action.id}
      className="ff-editor__btn"
      data-action={action.id}
      title={action.title}
      disabled={disabled}
      onClick={() => action.onSelect(api)}
    >
      {action.label}
    </button>
  );
}

function newNodeId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function downloadWorkflow(schema: WorkflowSchema, metadata?: WorkflowMetadata) {
  const url = URL.createObjectURL(workflowToBlob(schema));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${metadata?.id ?? "workflow"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function pickWorkflow(onLoad: (graph: FlowGraph) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const result = importWorkflow(JSON.parse(await file.text()), { lenient: true });
      onLoad(result.graph);
    } catch (e) {
      console.error("import failed", e);
    }
  };
  input.click();
}

/**
 * Build a UseFlowStateReturn-shaped adapter that proxies through to the
 * host's onChange. Edits route through onChange; reads come from `value`.
 */
function makeControlledFlowAdapter(
  value: FlowGraph,
  onChange?: (graph: FlowGraph) => void,
): UseFlowStateReturn {
  const apply = (next: FlowGraph) => onChange?.(next);
  return {
    nodes: value.nodes,
    edges: value.edges,
    setNodes: (next) => {
      const nextNodes = typeof next === "function" ? (next as any)(value.nodes) : next;
      apply({ nodes: nextNodes, edges: value.edges });
    },
    setEdges: (next) => {
      const nextEdges = typeof next === "function" ? (next as any)(value.edges) : next;
      apply({ nodes: value.nodes, edges: nextEdges });
    },
    // Atomic both-at-once commit — the reason this exists (see UseFlowStateReturn).
    setGraph: (graph) => apply(graph),
    onNodesChange: (changes) => {
      apply({ nodes: applyNodeChanges(changes, value.nodes) as any, edges: value.edges });
    },
    onEdgesChange: (changes) => {
      apply({ nodes: value.nodes, edges: applyEdgeChanges(changes, value.edges) });
    },
    onConnect: (connection: Connection) => {
      apply({ nodes: value.nodes, edges: addEdge(connection, value.edges) as Edge[] });
    },
    toGraph: () => value,
  };
}

/**
 * EdgeLabelEditor — small popover for naming a connection.
 *
 * Anchored in viewport coords like the context menu it replaces. Enter
 * commits, Escape cancels, blur commits (so clicking away doesn't silently
 * discard the edit).
 */
function EdgeLabelEditor({
  x,
  y,
  initial,
  onCommit,
  onCancel,
}: {
  x: number;
  y: number;
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div
      className="ff-editor__ctx ff-editor__edge-label"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        className="ff-panel__input"
        value={text}
        placeholder="Label this connection"
        aria-label="Connection label"
        data-action="edge-label-input"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Stop the canvas seeing these — Backspace would delete the edge
          // out from under the editor.
          e.stopPropagation();
          if (e.key === "Enter") onCommit(text);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onCommit(text)}
      />
    </div>
  );
}
