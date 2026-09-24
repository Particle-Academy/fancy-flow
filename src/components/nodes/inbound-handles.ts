import { useNodeConnections } from "@xyflow/react";
import type { PortDescriptor } from "../../types";

/** Return input keys used by inbound edges that the node did not declare. */
export function undeclaredInboundHandles(
  connections: ReadonlyArray<{ targetHandle?: string | null }>,
  declared: ReadonlyArray<PortDescriptor>,
): string[] {
  const declaredIds = new Set(declared.map((port) => port.id));
  return [...new Set(connections.map((connection) => connection.targetHandle ?? "in"))].filter(
    (id) => !declaredIds.has(id),
  );
}

/** Read the current graph's inbound edges from inside an xyflow node. */
export function useUndeclaredInboundHandles(nodeId: string, declared: ReadonlyArray<PortDescriptor>): string[] {
  const connections = useNodeConnections({ id: nodeId, handleType: "target" });
  return undeclaredInboundHandles(connections, declared);
}
