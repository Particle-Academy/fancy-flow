import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
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
import { useFlowRun, applyStatusesToNodes } from "../../runtime/use-flow-run";
import { exportWorkflow, importWorkflow, workflowToBlob, type WorkflowMetadata, type WorkflowSchema } from "../../schema";
import { buildNodeTypes, defaultConfigFor, getNodeKind, listNodeKinds, onNodeKindsChanged } from "../../registry";
import type { ExecutorRegistry, FlowGraph, FlowNode } from "../../types";
import { duplicateNode as cloneNode, removeEdges, removeNodes } from "./graph-ops";
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
  apiRef,
}: FlowEditorProps & { apiRef?: React.ForwardedRef<FlowEditorApi> }) {
  const internal = useFlowState(initial);
  const runner = useFlowRun();
  const rf = useReactFlow();

  // When `value` is provided we run in controlled mode: host owns nodes/edges,
  // local edits go through onChange. Internal state is unused but the hook
  // still has to run (rules of hooks).
  const controlled = value !== undefined;
  const flow = controlled ? makeControlledFlowAdapter(value!, onChange) : internal;

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

  const handleNodeClick: NodeMouseHandler = (_e, node) => setSelectedId(node.id);

  // Right-click menu. Anchored in viewport coords (position: fixed), so it is
  // not clipped by the canvas' overflow.
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  const handleNodeContextMenu: NodeMouseHandler = (event, node) => {
    event.preventDefault();
    setSelectedId(node.id);
    setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  };

  // Dismiss on any outside click, scroll, or Escape.
  useEffect(() => {
    if (menu === null) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

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
    (ids: string[]) => {
      if (ids.length === 0) return;
      const doomed = new Set(ids);
      flow.setNodes((all: FlowNode[]) => removeNodes({ nodes: all, edges: [] }, ids).nodes);
      flow.setEdges((all: Edge[]) => removeNodes({ nodes: [], edges: all }, ids).edges);
      setSelectedId((cur) => (cur !== null && doomed.has(cur) ? null : cur));
      onDelete?.(ids);
    },
    [flow, onDelete],
  );

  const api: FlowEditorApi = useMemo(() => {
    const toWorkflow = () => exportWorkflow({ nodes: flow.nodes, edges: flow.edges }, metadata);

    return {
      graph: { nodes: flow.nodes, edges: flow.edges },
      nodes: flow.nodes,
      edges: flow.edges,
      selectedId,
      selected,
      running: runner.running,
      statuses: runner.statuses,

      select: setSelectedId,

      addNode,
      updateNode: (next) => flow.setNodes((all: FlowNode[]) => all.map((x) => (x.id === next.id ? next : x))),
      deleteNodes,
      deleteSelected: () => deleteNodes(selectedId ? [selectedId] : []),
      deleteEdges: (ids) => flow.setEdges((all: Edge[]) => removeEdges(all, ids)),
      duplicateNode: (id) => {
        const src = flow.nodes.find((n) => n.id === id);
        if (!src) return null;
        const copy = cloneNode(src, newNodeId());
        flow.setNodes((all: FlowNode[]) => [...all, copy]);
        setSelectedId(copy.id);
        return copy.id;
      },
      setGraph: (graph) => {
        flow.setNodes(graph.nodes);
        flow.setEdges(graph.edges);
      },

      run: () => runner.run({ nodes: flow.nodes, edges: flow.edges }, executors),
      cancel: runner.cancel,
      reset: runner.reset,

      toWorkflow,
      exportWorkflow: () => downloadWorkflow(toWorkflow(), metadata),
      importWorkflow: () =>
        pickWorkflow((graph) => {
          flow.setNodes(graph.nodes);
          flow.setEdges(graph.edges);
        }),

      fitView: () => rf.fitView({ padding: 0.2 }),
    };
  }, [flow, selectedId, selected, runner, executors, metadata, addNode, deleteNodes, rf]);

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
      {(builtins.delete !== false || builtins.export !== false || builtins.import !== false) && (
        <span className="ff-editor__sep" />
      )}
      {builtins.delete !== false && (
        <button
          className="ff-editor__btn"
          data-action="delete"
          onClick={api.deleteSelected}
          disabled={api.selected === null}
          title="Delete the selected node (Del / Backspace)"
        >
          ✕ Delete
        </button>
      )}
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
          onNodeClick={handleNodeClick}
          onNodeContextMenu={builtins.contextMenu === false ? undefined : handleNodeContextMenu}
          onNodesDelete={(deleted) => onDelete?.(deleted.map((n) => n.id))}
          // Both keys delete, so muscle memory from either platform works.
          deleteKeyCode={["Delete", "Backspace"]}
          height="100%"
          toolbar={toolbar}
          {...canvasProps}
        />
        {slots.empty && api.nodes.length === 0 && (
          <div className="ff-editor__empty">{slots.empty(api)}</div>
        )}
        {menu !== null && builtins.contextMenu !== false && (
          <div
            className="ff-editor__ctx"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
            // Keep the outside-click listener from closing us before the click lands.
            onClick={(e) => e.stopPropagation()}
          >
            {slots.contextMenu ? (
              slots.contextMenu(api, menu.nodeId, closeMenu)
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="ff-editor__ctx-item"
                  data-action="ctx-duplicate"
                  onClick={() => { api.duplicateNode(menu.nodeId); closeMenu(); }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ff-editor__ctx-item ff-editor__ctx-item--danger"
                  data-action="ctx-delete"
                  onClick={() => { api.deleteNodes([menu.nodeId]); closeMenu(); }}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
        {showFeed &&
          (slots.feed ? slots.feed(api) : <FlowRunFeed entries={runner.feed} className="ff-editor__feed" />)}
      </div>
      {showPanel &&
        (slots.panel ? (
          slots.panel(api)
        ) : (
          <div className="ff-editor__panel-wrap">
            <NodeConfigPanel className="ff-editor__panel" node={api.selected} onChange={api.updateNode} />
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
