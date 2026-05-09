import type { NodeTypes } from "@xyflow/react";
import { TriggerNode } from "./TriggerNode";
import { ActionNode } from "./ActionNode";
import { DecisionNode } from "./DecisionNode";
import { OutputNode } from "./OutputNode";
import { NoteNode } from "./NoteNode";
import { SubgraphNode } from "./SubgraphNode";

export { TriggerNode, ActionNode, DecisionNode, OutputNode, NoteNode, SubgraphNode };
export { NodeShell, type NodeShellProps } from "./NodeShell";

/**
 * Default xyflow `nodeTypes` map covering the kit. Spread into your own:
 *
 *   <FlowCanvas nodeTypes={{ ...defaultNodeTypes, custom: MyNode }} ... />
 */
export const defaultNodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  decision: DecisionNode,
  output: OutputNode,
  note: NoteNode,
  subgraph: SubgraphNode,
};
