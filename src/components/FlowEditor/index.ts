export { FlowEditor, type FlowEditorProps } from "./FlowEditor";
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
