// Public surface for @particle-academy/fancy-flow.

// Auto-register the built-in agentic kit on import. Hosts can replace
// individual kinds via re-registration after this fires.
import { registerBuiltinKinds } from "./registry/builtin";
registerBuiltinKinds();

// Editor
export { FlowCanvas, type FlowCanvasProps } from "./components/canvas";
export { FlowEditor, type FlowEditorProps } from "./components/FlowEditor";
export { NodePalette, paletteDropHandlers, type NodePaletteProps } from "./components/NodePalette";
export {
  NodeConfigPanel,
  ConfigFieldRenderer,
  type NodeConfigPanelProps,
  type ConfigFieldRendererProps,
} from "./components/NodeConfigPanel";

// Legacy 6-pack (kept for backwards compat with v0.1; new work uses the registry)
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

// Registry (also: fancy-flow/registry)
export {
  registerNodeKind,
  getNodeKind,
  listNodeKinds,
  onNodeKindsChanged,
  defaultConfigFor,
  validateConfig,
  categoryAccent,
  buildNodeTypes,
  RegistryNode,
  registerBuiltinKinds,
  BUILTIN_KINDS,
  type NodeKindDefinition,
  type NodeCategory,
  type ConfigField,
  type RenderBodyContext,
} from "./registry";

// Schema (also: fancy-flow/schema)
export {
  exportWorkflow,
  importWorkflow,
  workflowToBlob,
  WORKFLOW_SCHEMA_VERSION,
  WORKFLOW_SCHEMA_URL,
  type WorkflowSchema,
  type WorkflowSchemaNode,
  type WorkflowSchemaEdge,
  type WorkflowMetadata,
  type ImportIssue,
  type ImportResult,
  type ImportOptions,
} from "./schema";

// Runtime (also: fancy-flow/runtime)
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
