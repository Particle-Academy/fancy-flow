import type { Connection, Edge } from "@xyflow/react";
import type { FlowNode, PortDescriptor } from "../types";
import { getNodeKind } from "./registry";
import { resolveNodePorts } from "./ports";

/**
 * Connection validation — the single rule that decides whether an edge between
 * two ports is allowed. Lives here (React-free, registry-adjacent) so BOTH the
 * canvas (`<FlowCanvas isValidConnection>`) and the agent bridge's
 * `flow_connect` tool call the same function: a connection the canvas refuses
 * is a connection an agent cannot sneak past, and vice versa — no drift.
 *
 * `PortDescriptor.type` has always documented itself as being "for hosts that
 * want to validate connections", but nothing consumed it. This wires it up.
 */

/**
 * Wildcard port type — matches any other type. A port that declares no `type`
 * is treated as a wildcard too, so existing flows (whose ports are untyped)
 * validate exactly as before.
 */
export const ANY_PORT_TYPE = "any";

/** Decides whether a source-output port may feed a target-input port. */
export type PortCompatibility = (
  source: PortDescriptor | undefined,
  target: PortDescriptor | undefined,
) => boolean;

/**
 * Default compatibility rule: allow the connection UNLESS both ports declare a
 * concrete, differing type. An absent type or the `any` wildcard matches
 * anything — so typed ports get enforced while untyped ports stay permissive,
 * making this a safe default that never breaks an existing untyped graph.
 */
export const defaultPortCompatibility: PortCompatibility = (source, target) => {
  const s = source?.type;
  const t = target?.type;
  if (!s || !t) return true;
  if (s === ANY_PORT_TYPE || t === ANY_PORT_TYPE) return true;
  return s === t;
};

export type ConnectionValidatorOptions = {
  /** Override the type-compatibility rule. Defaults to {@link defaultPortCompatibility}. */
  compatible?: PortCompatibility;
  /**
   * Allow a node's own output to feed its own input (a self-loop). Default
   * false — self-connections are almost always an accident, and the rare flow
   * that wants one can opt in.
   */
  allowSelfConnection?: boolean;
};

/** Resolve a node's effective ports for one side, going through the registry. */
function portsFor(node: FlowNode, side: "inputs" | "outputs"): PortDescriptor[] {
  const kind = getNodeKind((node.data as any)?.kind ?? node.type);
  const resolved = resolveNodePorts(node, kind ?? undefined);
  return resolved[side] ?? [];
}

/**
 * Resolve which port a handle id refers to. When a side has a single port and
 * the handle id is absent (React Flow omits it for a lone default handle), use
 * that port; otherwise match by id.
 */
function findPort(
  ports: PortDescriptor[],
  handleId: string | null | undefined,
): PortDescriptor | undefined {
  if (handleId == null) return ports.length === 1 ? ports[0] : undefined;
  return ports.find((p) => p.id === handleId);
}

/**
 * Build an `isValidConnection` predicate that enforces port-type compatibility
 * against a live node list. Pass it straight to `<FlowCanvas isValidConnection>`
 * or reuse it to gate an agent's `flow_connect`.
 *
 * `getNodes` is called on every check so the validator always sees the current
 * graph (wire it to a ref/state getter, not a snapshot).
 *
 * A connection is rejected when: an endpoint is missing; it is a self-loop and
 * `allowSelfConnection` is off; either node is unknown; or the resolved ports
 * are type-incompatible. Nodes/ports with no declared type validate as before.
 */
export function createConnectionValidator(
  getNodes: () => FlowNode[],
  options: ConnectionValidatorOptions = {},
): (connection: Connection | Edge) => boolean {
  const compatible = options.compatible ?? defaultPortCompatibility;
  return (connection) => {
    const { source, target, sourceHandle, targetHandle } = connection;
    if (!source || !target) return false;
    if (!options.allowSelfConnection && source === target) return false;

    const nodes = getNodes();
    const src = nodes.find((n) => n.id === source);
    const tgt = nodes.find((n) => n.id === target);
    if (!src || !tgt) return false;

    const outPort = findPort(portsFor(src, "outputs"), sourceHandle);
    const inPort = findPort(portsFor(tgt, "inputs"), targetHandle);
    return compatible(outPort, inPort);
  };
}
