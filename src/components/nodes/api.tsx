/**
 * Authoring API for custom node kinds. The point of this file is to keep
 * consumers from importing @xyflow/react directly when they write a node —
 * they get `defineNode` + `<NodePort>` from us, and we hold the seam.
 *
 * Internal node code (NodeShell, RegistryNode, FlowCanvas) still imports
 * from @xyflow/react directly. The hiding is only for the public authoring
 * surface.
 */
import { memo, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "../../types";

/**
 * Subset of NodeProps that the typical node author cares about. Strips the
 * react-flow-specific surface (xPos, yPos, dragging, zIndex, isConnectable,
 * targetPosition, sourcePosition, etc.) — if you need any of that you can
 * still import directly, but you usually don't.
 */
export interface FlowNodeRenderProps<TData = unknown> {
  id: string;
  data: TData;
  selected: boolean;
}

/**
 * Wraps a render function as a memoized node component compatible with the
 * underlying flow engine.
 *
 *   const MyNode = defineNode<MyData>(({ data, selected }) => (
 *     <div>
 *       <NodePort side="left" type="target" />
 *       <span>{data.label}</span>
 *       <NodePort side="right" type="source" />
 *     </div>
 *   ));
 */
export function defineNode<TData = unknown>(
  render: (props: FlowNodeRenderProps<TData>) => ReactNode,
): ComponentType<NodeProps<FlowNode>> {
  function Wrapped(props: NodeProps<FlowNode>) {
    return render({
      id: props.id,
      data: props.data as TData,
      selected: Boolean(props.selected),
    });
  }
  Wrapped.displayName = "FancyFlowNode";
  return memo(Wrapped);
}

export type NodePortSide = "left" | "right" | "top" | "bottom";
export type NodePortType = "source" | "target";

const POSITION_MAP: Record<NodePortSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

export interface NodePortProps {
  /** Which edge of the node the port docks on. */
  side: NodePortSide;
  /** Direction of data flow. `source` emits; `target` receives. */
  type: NodePortType;
  /** Stable id — required when a node has multiple ports on the same side. */
  id?: string;
  style?: CSSProperties;
  title?: string;
  className?: string;
}

/**
 * Connection handle. Render one per port; the flow engine wires edges to
 * matching `id`s on the source and target nodes.
 *
 *   <NodePort side="left"  type="target" id="in" />
 *   <NodePort side="right" type="source" id="ok" title="success" />
 *   <NodePort side="right" type="source" id="err" title="error" style={{ top: '70%' }} />
 */
export function NodePort({ side, type, id, style, title, className }: NodePortProps) {
  return (
    <Handle
      position={POSITION_MAP[side]}
      type={type}
      id={id}
      style={style}
      title={title}
      className={className}
    />
  );
}
