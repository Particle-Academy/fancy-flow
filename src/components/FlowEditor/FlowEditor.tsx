import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
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
import { FlowCanvas } from "../canvas/FlowCanvas";
import { NodePalette, paletteDropHandlers } from "../NodePalette";
import { NodeConfigPanel } from "../NodeConfigPanel";
import { FlowRunControls } from "../FlowRunControls";
import { FlowRunFeed } from "../FlowRunFeed";
import { useFlowState } from "../../runtime/use-flow-state";
import { useFlowRun, applyStatusesToNodes } from "../../runtime/use-flow-run";
import { exportWorkflow, importWorkflow, workflowToBlob, type WorkflowMetadata, type WorkflowSchema } from "../../schema";
import { buildNodeTypes, defaultConfigFor, getNodeKind, listNodeKinds, onNodeKindsChanged } from "../../registry";
import type { ExecutorRegistry, FlowGraph, FlowNode } from "../../types";

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
  /** Optional toolbar content rendered next to the run controls. */
  extraToolbar?: ReactNode;
  /** Called whenever the graph changes — host can persist. */
  onChange?: (graph: FlowGraph) => void;
  className?: string;
  style?: CSSProperties;
};

/**
 * FlowEditor — opinionated, batteries-included workflow editor. Composes
 * NodePalette + FlowCanvas + NodeConfigPanel + run controls + run feed
 * with sensible defaults. Hosts that want à la carte can use the
 * primitives directly.
 */
export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <div
        className={["ff-editor", props.className ?? ""].filter(Boolean).join(" ")}
        style={{ height: props.height ?? 720, ...props.style }}
      >
        <FlowEditorInner {...props} />
      </div>
    </ReactFlowProvider>
  );
}

function FlowEditorInner({
  initial = { nodes: [], edges: [] },
  value,
  executors = {},
  metadata,
  showPalette = true,
  showPanel = true,
  showFeed = true,
  extraToolbar,
  onChange,
}: FlowEditorProps) {
  const internal = useFlowState(initial);
  const runner = useFlowRun();

  // When `value` is provided we run in controlled mode: host owns nodes/edges,
  // local edits go through onChange. Internal state is unused but the hook
  // still has to run (rules of hooks).
  const controlled = value !== undefined;
  const flow = controlled
    ? makeControlledFlowAdapter(value!, onChange)
    : internal;

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

  const handleNodeClick: NodeMouseHandler = (_e, node) => setSelectedId(node.id);

  // Uncontrolled: notify host on every graph mutation. Controlled mode
  // already notifies via the adapter on each setNodes/setEdges call.
  useEffect(() => {
    if (!controlled) onChange?.({ nodes: flow.nodes, edges: flow.edges });
  }, [flow.nodes, flow.edges, onChange, controlled]);

  return (
    <FlowEditorBody
      showPalette={showPalette}
      showPanel={showPanel}
      showFeed={showFeed}
      flow={flow}
      runner={runner}
      executors={executors}
      metadata={metadata}
      nodeTypes={nodeTypes}
      renderedNodes={renderedNodes}
      selected={selected}
      setSelectedId={setSelectedId}
      handleNodeClick={handleNodeClick}
      extraToolbar={extraToolbar}
    />
  );
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

function FlowEditorBody({
  showPalette, showPanel, showFeed,
  flow, runner, executors, metadata,
  nodeTypes, renderedNodes, selected, setSelectedId, handleNodeClick, extraToolbar,
}: any) {
  const rf = useReactFlow();

  const dropHandlers = paletteDropHandlers((kindName, evt) => {
    const kind = getNodeKind(kindName);
    if (!kind) return;
    const point = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
    const id = `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    flow.setNodes((all: FlowNode[]) => [
      ...all,
      {
        id, type: kind.name,
        position: { x: point.x - 100, y: point.y - 30 },
        data: { kind: kind.name, label: kind.label, config: defaultConfigFor(kind) } as any,
      } as FlowNode,
    ]);
    setSelectedId(id);
  });

  const doExport = () => {
    const schema: WorkflowSchema = exportWorkflow({ nodes: flow.nodes, edges: flow.edges }, metadata);
    const url = URL.createObjectURL(workflowToBlob(schema));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${metadata?.id ?? "workflow"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const doImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const result = importWorkflow(JSON.parse(text), { lenient: true });
        flow.setNodes(result.graph.nodes);
        flow.setEdges(result.graph.edges);
      } catch (e) {
        console.error("import failed", e);
      }
    };
    input.click();
  };

  return (
    <>
      {showPalette && <NodePalette className="ff-editor__palette" />}
      <div className="ff-editor__main" {...dropHandlers}>
        <FlowCanvas
          nodes={renderedNodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          onNodesChange={flow.onNodesChange}
          onEdgesChange={flow.onEdgesChange}
          onConnect={flow.onConnect}
          onNodeClick={handleNodeClick}
          height="100%"
          toolbar={
            <>
              <FlowRunControls
                running={runner.running}
                onRun={() => runner.run({ nodes: flow.nodes, edges: flow.edges }, executors)}
                onCancel={runner.cancel}
                onReset={runner.reset}
              />
              <span className="ff-editor__sep" />
              <button className="ff-editor__btn" onClick={doExport}>↓ Export</button>
              <button className="ff-editor__btn" onClick={doImport}>↑ Import</button>
              {extraToolbar}
              <span className="ff-editor__count">{flow.nodes.length} nodes · {flow.edges.length} edges</span>
            </>
          }
        />
        {showFeed && <FlowRunFeed entries={runner.feed} className="ff-editor__feed" />}
      </div>
      {showPanel && (
        <NodeConfigPanel
          className="ff-editor__panel"
          node={selected}
          onChange={(next: FlowNode) => flow.setNodes((all: FlowNode[]) => all.map((x) => (x.id === next.id ? next : x)))}
        />
      )}
    </>
  );
}
