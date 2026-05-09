import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { FlowNode, SubgraphNodeData } from "../../types";
import { NodeShell } from "./NodeShell";

/**
 * SubgraphNode — collapses a group of nodes behind a single facade with
 * inputs and outputs that map to the inner graph's boundary ports. The
 * runtime treats it like an action node: when running, it dispatches to
 * the registered "subgraph" executor (host decides expand vs inline).
 *
 * v0.1 just renders the facade. Expand/collapse interactions and inner-
 * graph editing are deferred — host apps can implement those by toggling
 * `data.collapsed` and rendering a nested <FlowCanvas> when expanded.
 */
function SubgraphNodeInner(props: NodeProps<FlowNode>) {
  const data = props.data as SubgraphNodeData;
  const childCount = data.childIds?.length ?? 0;
  return (
    <NodeShell node={props} accent="#0ea5e9" tag="SUBGRAPH" icon="❐">
      <div className="ff-subgraph__meta">
        <span>{childCount} node{childCount === 1 ? "" : "s"}</span>
        <span>{data.collapsed === false ? "expanded" : "collapsed"}</span>
      </div>
    </NodeShell>
  );
}
export const SubgraphNode = memo(SubgraphNodeInner);
