import { type CSSProperties, type ReactNode, useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type DefaultEdgeOptions,
  type Edge,
  type EdgeTypes,
  type FitViewOptions,
  type NodeTypes,
  type ReactFlowProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { defaultNodeTypes } from "../nodes";
import type { FlowNode } from "../../types";

export type FlowCanvasProps = Omit<ReactFlowProps<FlowNode, Edge>, "nodes" | "edges"> & {
  nodes: FlowNode[];
  edges: Edge[];
  /** Background variant. Default: "dots". */
  background?: BackgroundVariant | "none";
  /** Show pan/zoom/fit controls. Default true. */
  showControls?: boolean;
  /** Show minimap. Default false (turn on for big graphs). */
  showMinimap?: boolean;
  /** Pixel height; FlowCanvas expects a sized container. Default 600. */
  height?: number | string;
  /** Optional toolbar / palette etc. rendered above the canvas. */
  toolbar?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

const DEFAULT_FIT_VIEW: FitViewOptions = { padding: 0.2 };
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: "smoothstep",
  animated: false,
};

/**
 * FlowCanvas — themed React Flow surface with the kit's nodes registered
 * by default. Pass your own `nodeTypes` to extend; the kit's defaults are
 * merged behind yours.
 *
 * Hosts wire `onNodesChange` / `onEdgesChange` / `onConnect` themselves
 * (xyflow's standard pattern). The surrounding `useFlowState` hook in
 * `runtime/use-flow-state.ts` is a convenience that wires those for you.
 */
export function FlowCanvas({
  nodes,
  edges,
  background = "dots",
  showControls = true,
  showMinimap = false,
  height = 600,
  toolbar,
  nodeTypes,
  edgeTypes,
  className,
  style,
  ...rest
}: FlowCanvasProps) {
  const mergedNodeTypes = useMemo<NodeTypes>(
    () => ({ ...defaultNodeTypes, ...(nodeTypes ?? {}) }),
    [nodeTypes],
  );

  const mergedEdgeTypes = useMemo<EdgeTypes | undefined>(
    () => (edgeTypes ? { ...edgeTypes } : undefined),
    [edgeTypes],
  );

  return (
    <div className={["ff-canvas", className ?? ""].filter(Boolean).join(" ")} style={{ height, ...style }}>
      {toolbar && <div className="ff-canvas__toolbar">{toolbar}</div>}
      <div className="ff-canvas__surface">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={mergedNodeTypes}
          edgeTypes={mergedEdgeTypes}
          fitView
          fitViewOptions={DEFAULT_FIT_VIEW}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          proOptions={{ hideAttribution: true }}
          {...rest}
        >
          {background !== "none" && (
            <Background variant={background as BackgroundVariant} gap={20} size={1} color="rgba(0,0,0,0.18)" />
          )}
          {showControls && <Controls className="ff-controls" position="bottom-right" />}
          {showMinimap && <MiniMap className="ff-minimap" pannable zoomable />}
        </ReactFlow>
      </div>
    </div>
  );
}
