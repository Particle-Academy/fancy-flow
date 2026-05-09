import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { FlowNode } from "../../types";
import { NodeShell } from "./NodeShell";

/** General-purpose work node — inputs and outputs. */
function ActionNodeInner(props: NodeProps<FlowNode>) {
  return <NodeShell node={props} accent="#3b82f6" tag="ACTION" icon="▸" />;
}
export const ActionNode = memo(ActionNodeInner);
