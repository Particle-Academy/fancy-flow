import { type CSSProperties, type ReactNode, useMemo, useRef } from "react";
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
import { createConnectionValidator, type ConnectionValidatorOptions } from "../../registry/connection";
import type { FlowNode } from "../../types";

export type FlowCanvasProps = Omit<ReactFlowProps<FlowNode, Edge>, "nodes" | "edges" | "height"> & {
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
  /**
   * Enforce port-type compatibility on new connections. `true` (default) uses
   * the built-in validator: a connection is refused only when both ports
   * declare a concrete, differing `type` (so untyped graphs are unaffected),
   * and self-loops are blocked. Pass options to tune the rule, or `false` to
   * disable. An `isValidConnection` you pass yourself always takes precedence.
   */
  validateConnections?: boolean | ConnectionValidatorOptions;
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
  background = BackgroundVariant.Dots,
  showControls = true,
  showMinimap = false,
  height = 600,
  validateConnections = true,
  isValidConnection,
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

  // Read nodes live through a ref so the validator (built once) always sees the
  // current graph without being rebuilt on every node change.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const builtinValidator = useMemo(
    () =>
      validateConnections === false
        ? undefined
        : createConnectionValidator(
            () => nodesRef.current,
            validateConnections === true ? undefined : validateConnections,
          ),
    [validateConnections],
  );
  // A caller-supplied predicate wins; otherwise fall back to port-type validation.
  const resolvedIsValidConnection = isValidConnection ?? builtinValidator;

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
          // Embedded-in-a-page friendly: a bare wheel scrolls the PAGE (so the
          // canvas never traps the scroll), and Shift+wheel zooms the canvas.
          // Drag still pans. All overridable via props.
          zoomActivationKeyCode="Shift"
          preventScrolling={false}
          isValidConnection={resolvedIsValidConnection}
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
