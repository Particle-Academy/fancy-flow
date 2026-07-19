import type { FlowNode, PortDescriptor } from "../types";
import type { NodeKindDefinition, PortSpec } from "./types";

/**
 * Port resolution — the single place a node's ports are derived, shared by
 * the canvas renderer and the headless runtime.
 *
 * This module is deliberately React-free: `runFlow` (the `/engine` entry)
 * imports it, and the engine bundle must stay free of React.
 *
 * ## Why this is centralized
 *
 * Ports used to be read in two places that disagreed — the canvas consulted
 * `data.outputs ?? kind.outputs`, while the runtime consulted `data.outputs`
 * ONLY and fell back to a single `out` port. A kind that declared branch ports
 * therefore drew correctly and then routed as if it had one output, unless the
 * host remembered to mirror the ports onto every node's `data`. Both callers
 * now go through `resolveNodePorts`, so declared ports and executed ports
 * cannot drift apart.
 */

/**
 * Resolve a `PortSpec` against a config object.
 *
 * A config-driven spec is author-supplied and runs on every render, so a throw
 * is contained: it degrades to "undeclared" (letting the caller fall back)
 * rather than taking out the canvas or aborting a run mid-flight.
 */
export function resolvePortSpec<TConfig>(
  spec: PortSpec<TConfig> | undefined,
  config: TConfig,
): PortDescriptor[] | undefined {
  if (spec === undefined) return undefined;
  if (typeof spec !== "function") return spec;
  try {
    const resolved = (spec as (c: TConfig) => PortDescriptor[])(config);
    return Array.isArray(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/** Read the config bag off a node, tolerating the FlowNodeData union. */
export function nodeConfig(node: Pick<FlowNode, "data">): Record<string, unknown> {
  return ((node.data as any)?.config ?? {}) as Record<string, unknown>;
}

/**
 * Resolve a node's effective ports.
 *
 * Precedence: explicit `data.inputs`/`data.outputs` (a per-node host override)
 * beats the kind's declaration. `undefined` means "nothing declared" — the
 * caller applies its own category default.
 */
export function resolveNodePorts(
  node: Pick<FlowNode, "data">,
  kind?: Pick<NodeKindDefinition<any>, "inputs" | "outputs">,
): { inputs?: PortDescriptor[]; outputs?: PortDescriptor[] } {
  const config = nodeConfig(node);
  const data = node.data as any;
  return {
    inputs: data?.inputs ?? resolvePortSpec(kind?.inputs, config),
    outputs: data?.outputs ?? resolvePortSpec(kind?.outputs, config),
  };
}
