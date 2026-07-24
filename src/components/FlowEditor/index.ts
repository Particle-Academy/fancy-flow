export { FlowEditor, type FlowEditorProps } from "./FlowEditor";
// The in-editor human-input modal + its field-normalizer, exported so a host can
// reuse them (e.g. in a custom run harness) or render the modal themselves.
export { HumanPrompt, humanInputFields, type HumanField, type HumanPromptRequest } from "./HumanPrompt";
export {
  useFlowEditor,
  useFlowEditorOptional,
  type FlowEditorApi,
  type FlowEditorAction,
  type FlowEditorBuiltins,
  type FlowEditorSlots,
} from "./api";
// Pure graph operations — reusable by hosts building custom editors and by the
// agent bridge, so bridge and canvas share one implementation (no drift).
export {
  cloneSubgraph,
  reconnectEdge,
  alignNodes,
  distributeNodes,
  duplicateNode,
  removeNodes,
  removeEdges,
  setEdgeLabel,
  type AlignEdge,
} from "./graph-ops";
