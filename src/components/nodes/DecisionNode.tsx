import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { FlowNode, PortDescriptor } from "../../types";
import { NodeShell } from "./NodeShell";

const DEFAULT_BRANCHES: PortDescriptor[] = [
  { id: "true", label: "true" },
  { id: "false", label: "false" },
];

/** Branching node — multiple typed outputs, one input. */
function DecisionNodeInner(props: NodeProps<FlowNode>) {
  // If the host hasn't customised outputs, default to a true/false split.
  if (!props.data.outputs) {
    props = { ...props, data: { ...props.data, outputs: DEFAULT_BRANCHES } };
  }
  return <NodeShell node={props} accent="#f59e0b" tag="DECISION" icon="◇" />;
}
export const DecisionNode = memo(DecisionNodeInner);
