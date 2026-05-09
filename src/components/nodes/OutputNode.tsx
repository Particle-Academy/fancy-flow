import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { FlowNode } from "../../types";
import { NodeShell } from "./NodeShell";

/** Terminal node — receives the workflow's final result; no outputs. */
function OutputNodeInner(props: NodeProps<FlowNode>) {
  return <NodeShell node={props} accent="#a855f7" tag="OUTPUT" icon="●" showOutputs={false} />;
}
export const OutputNode = memo(OutputNodeInner);
