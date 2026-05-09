import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { FlowNode } from "../../types";
import { NodeShell } from "./NodeShell";

/** Entry-point node — outputs only, no inputs. */
function TriggerNodeInner(props: NodeProps<FlowNode>) {
  return <NodeShell node={props} accent="#10b981" tag="TRIGGER" icon="⚡" showInputs={false} />;
}
export const TriggerNode = memo(TriggerNodeInner);
