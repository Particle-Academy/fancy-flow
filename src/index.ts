// Public surface for @particle-academy/fancy-flow.

// Register the built-in agentic kit. The registry ALSO ensures this itself on
// first use, so a consumer importing a subpath (or only types) still gets the
// kit -- this call just makes it eager for the common root import. Hosts can
// replace individual kinds via re-registration after it fires.
import { registerBuiltinKinds } from "./registry/builtin";
import { ensureBuiltinKinds } from "./registry/registry";
ensureBuiltinKinds();

// Editor
export { FlowCanvas, type FlowCanvasProps } from "./components/canvas";
export {
  FlowEditor,
  useFlowEditor,
  useFlowEditorOptional,
  type FlowEditorProps,
  type FlowEditorApi,
  type FlowEditorAction,
  type FlowEditorBuiltins,
  type FlowEditorSlots,
  cloneSubgraph,
  reconnectEdge,
  alignNodes,
  distributeNodes,
  type AlignEdge,
} from "./components/FlowEditor";
export { NodePalette, paletteDropHandlers, type NodePaletteProps } from "./components/NodePalette";
export {
  FlowViewer,
  type FlowViewerProps,
  type FlowViewerClassNames,
  type FlowNodeStatus,
} from "./components/FlowViewer";
export {
  NodeConfigPanel,
  ConfigFieldRenderer,
  type ConfigFieldRenderFn,
  type ConfigFieldRenderContext,
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
  LaneNode,
  NodeShell,
  defaultNodeTypes,
  type NodeShellProps,
} from "./components/nodes";

// Authoring API for custom node kinds — defineNode + NodePort. Consumers
// who write their own nodes use these instead of importing @xyflow/react,
// which keeps the underlying engine swappable and avoids react-flow types
// leaking into application code.
export {
  defineNode,
  NodePort,
  type FlowNodeRenderProps,
  type NodePortProps,
  type NodePortSide,
  type NodePortType,
} from "./components/nodes/api";

export { FlowRunControls, type FlowRunControlsProps } from "./components/FlowRunControls";
export { FlowRunFeed, type FlowRunFeedProps } from "./components/FlowRunFeed";

// Registry (also: fancy-flow/registry)
export {
  registerNodeKind,
  overrideNodeKind,
  clearNodeKindOverrides,
  type NodeKindPresentation,
  getNodeKind,
  listNodeKinds,
  onNodeKindsChanged,
  defaultConfigFor,
  validateConfig,
  categoryAccent,
  buildNodeTypes,
  RegistryNode,
  registerBuiltinKinds,
  ensureBuiltinKinds,
  BUILTIN_KINDS,
  resolvePortSpec,
  resolveNodePorts,
  createConnectionValidator,
  defaultPortCompatibility,
  ANY_PORT_TYPE,
  type PortCompatibility,
  type ConnectionValidatorOptions,
  registerRichInputAdapter,
  getRichInputAdapter,
  isRichInputEnabled,
  onRichInputAdapterChanged,
  RichInputPreview,
  type RichInputAdapter,
  type NodeKindDefinition,
  type EmitsRelation,
  type NodeCategory,
  type ConfigField,
  type RepeaterConfigField,
  type RepeaterRowField,
  type KeyValueConfigField,
  type DocumentConfigField,
  type PortSpec,
  type RenderBodyContext,
  pauseForHuman,
  encodePause,
  decodePause,
  isPause,
  PAUSE_PREFIX,
  LEGACY_PAUSE_PREFIXES,
  type PauseAwaiting,
  type PauseSignal,
} from "./registry";

// Schema (also: fancy-flow/schema)
export {
  exportWorkflow,
  importWorkflow,
  migrateSchema,
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
  runCohort,
  useFlowRun,
  useFlowState,
  useFlowHistory,
  createHistory,
  applyStatusesToNodes,
  applyOutputsToNodes,
  type RunOptions,
  type RunResult,
  type CohortGuard,
  type CohortOptions,
  type CohortPolicy,
  type CohortResult,
  type UseFlowRunReturn,
  type UseFlowRunOptions,
  type UseFlowStateReturn,
  type UseFlowHistoryReturn,
  type HistoryController,
  type FlowRunFeedEntry,
} from "./runtime";

// Auto-layout types (the value `autoLayout` lives on the `fancy-flow/layout`
// subpath so dagre stays out of the eager bundle; it's also on `api.autoLayout`).
export type { AutoLayoutOptions, AutoLayoutDirection } from "./layout";

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

export { flowLive, flowKeys } from "./live";

// Expression authoring — what an author can write in a `{{ }}` field at a given
// node, and the reference help that explains the grammar (issue #5).
export {
  availableVariables,
  baseVariables,
  describeExpressionGrammar,
  outputFieldsFor,
} from "./expressions/variables";
export type {
  AvailableVariable,
  ExpressionForm,
  ExpressionGrammarHelp,
  OutputField,
  OutputShape,
} from "./expressions/variables";
export { ExpressionField } from "./components/NodeConfigPanel/ExpressionField";
export type { ExpressionFieldProps } from "./components/NodeConfigPanel/ExpressionField";

// `{{ }}` resolution — the TypeScript twin of fancy-flow-php's `Expr`.
//
// OPT-IN: `runFlow` does not call these. It hands config to your executor
// verbatim, and every host using `{{ }}` today already resolves it itself, so
// resolving inside the runtime would interpolate a second time over values
// those hosts had already substituted. Call it yourself where you want it.
export {
  evaluateExpression,
  evaluateConfig,
  resolvePath,
  tryResolvePath,
  UnresolvedPathError,
  truthy,
  text,
} from "./expressions/expr";
export type {
  ExprContext,
  ExprValue,
  EvaluateOptions,
  Resolution,
  UnresolvedPolicy,
} from "./expressions/expr";

// ── Attach the built-in React renderers ─────────────────────────────────────
//
// `registry.ts` self-populates from the React-FREE data module, so `/engine`
// stays clean (#11). That leaves `lane`, `terminal_lane`, `note` and
// `rich_user_input` without their renderers until somebody re-registers the
// decorated versions, and this is that somebody.
//
// It lives HERE, at module scope in the root barrel, for a checkable reason
// rather than a convenient one: `package.json`'s `sideEffects` lists
// `./dist/index.js` and `./dist/index.cjs` and NOT `./dist/registry.js`. So a
// consumer's bundler is obliged to keep a top-level statement in this file and
// entitled to drop one in the registry chunk. Anywhere else works until a
// tree-shaker disagrees, and the symptom would be silent — lanes rendering as
// ordinary cards, no error anywhere.
//
// Importing the React entry is what says "I have a DOM". A queue worker that
// never imports this still gets every kind, schema, port and executor from the
// data module; it just gets no renderers, which is the correct answer for it.
registerBuiltinKinds();
