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

export {
  createConnectionValidator,
  defaultPortCompatibility,
  ANY_PORT_TYPE,
  type PortCompatibility,
  type ConnectionValidatorOptions,
} from "./connection";

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
  type WorkflowResolution,
  type WorkflowResolutionFailure,
  type CapabilityId,
  isResolutionFailure,
} from "./capabilities";

/**
 * The human-pause contract — a run waiting for a person, not a failure.
 * `decodePause` is the one function a durable runner needs.
 */
export {
  pauseForHuman,
  encodePause,
  decodePause,
  isPause,
  PAUSE_PREFIX,
  LEGACY_PAUSE_PREFIXES,
  type PauseAwaiting,
  type PauseSignal,
} from "./pause";

export { subflowExecutor, subflowPorts, subflowMode, DEFAULT_MAX_DEPTH, type SubflowMode } from "./subflow";
export { llmRouterExecutor, declaredRoutes, resolveFallbackPort } from "./llm-router";
/** @deprecated Renamed to `llmRouterExecutor` — the id and label now match. */
export { llmRouterExecutor as llmBranchExecutor } from "./llm-router";

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
