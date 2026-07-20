export type {
  ConfigField,
  TextConfigField,
  TextareaConfigField,
  NumberConfigField,
  SelectConfigField,
  SwitchConfigField,
  JsonConfigField,
  ExpressionConfigField,
  CredentialConfigField,
  RepeaterConfigField,
  RepeaterRowField,
  KeyValueConfigField,
  DocumentConfigField,
  NodeCategory,
  NodeKindDefinition,
  PortSpec,
  RenderBodyContext,
} from "./types";

export { resolvePortSpec, resolveNodePorts, nodeConfig } from "./ports";

/** Host capabilities — core declares the contract, the host supplies the impl. */
export {
  registerLlmClient,
  getLlmClient,
  registerWorkflowResolver,
  getWorkflowResolver,
  capabilityStatus,
  type LlmClient,
  type LlmRoute,
  type LlmRouteRequest,
  type LlmRouteChoice,
  type WorkflowResolver,
  type CapabilityId,
} from "./capabilities";

export { subflowExecutor, subflowPorts, subflowMode, DEFAULT_MAX_DEPTH, type SubflowMode } from "./subflow";
export { llmBranchExecutor, declaredRoutes, resolveFallbackPort } from "./llm-branch";

export {
  registerRichInputAdapter,
  getRichInputAdapter,
  isRichInputEnabled,
  onRichInputAdapterChanged,
  RichInputPreview,
  type RichInputAdapter,
} from "./rich-input";

export {
  registerNodeKind,
  getNodeKind,
  resolveKindId,
  kindIds,
  listNodeKinds,
  onNodeKindsChanged,
  defaultConfigFor,
  validateConfig,
  categoryAccent,
} from "./registry";

export { RegistryNode } from "./RegistryNode";
export { registerBuiltinKinds, BUILTIN_KINDS } from "./builtin";

import type { NodeTypes } from "@xyflow/react";
import { RegistryNode } from "./RegistryNode";
import { kindIds, listNodeKinds } from "./registry";

/**
 * Build an xyflow `nodeTypes` map from the registry — every registered
 * kind gets `RegistryNode` as its renderer. Refresh manually via
 * `useNodeTypes()` (a hook that subscribes to registry changes).
 */
export function buildNodeTypes(): NodeTypes {
  const map: NodeTypes = {};
  for (const k of listNodeKinds()) {
    // Key on every id the kind answers to, not just the canonical one. xyflow
    // looks the renderer up by `node.type` BEFORE RegistryNode gets a chance to
    // resolve aliases, so a graph still carrying pre-namespace types would fall
    // through to the unknown-node placeholder.
    for (const id of kindIds(k)) map[id] = RegistryNode;
  }
  return map;
}
