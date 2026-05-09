// Public surface for @particle-academy/fancy-flow.

// Editor
export { FlowCanvas, type FlowCanvasProps } from "./components/canvas";
export {
  TriggerNode,
  ActionNode,
  DecisionNode,
  OutputNode,
  NoteNode,
  SubgraphNode,
  NodeShell,
  defaultNodeTypes,
  type NodeShellProps,
} from "./components/nodes";
export { FlowRunControls, type FlowRunControlsProps } from "./components/FlowRunControls";
export { FlowRunFeed, type FlowRunFeedProps } from "./components/FlowRunFeed";

// Runtime (also available as a deep import: fancy-flow/runtime)
export {
  runFlow,
  useFlowRun,
  useFlowState,
  applyStatusesToNodes,
  type RunOptions,
  type RunResult,
  type UseFlowRunReturn,
  type UseFlowRunOptions,
  type UseFlowStateReturn,
  type FlowRunFeedEntry,
} from "./runtime";

// Domain types
export type {
  FlowNode,
  FlowEdge,
  FlowGraph,
  FlowNodeData,
  FlowNodeKind,
  TriggerNodeData,
  ActionNodeData,
  DecisionNodeData,
  OutputNodeData,
  NoteNodeData,
  SubgraphNodeData,
  BaseNodeData,
  PortDescriptor,
  NodeRunStatus,
  NodeExecutor,
  ExecutorRegistry,
  RunEvent,
} from "./types";
