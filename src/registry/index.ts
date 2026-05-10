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
  NodeCategory,
  NodeKindDefinition,
  RenderBodyContext,
} from "./types";

export {
  registerNodeKind,
  getNodeKind,
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
import { listNodeKinds } from "./registry";

/**
 * Build an xyflow `nodeTypes` map from the registry — every registered
 * kind gets `RegistryNode` as its renderer. Refresh manually via
 * `useNodeTypes()` (a hook that subscribes to registry changes).
 */
export function buildNodeTypes(): NodeTypes {
  const map: NodeTypes = {};
  for (const k of listNodeKinds()) map[k.name] = RegistryNode;
  return map;
}
