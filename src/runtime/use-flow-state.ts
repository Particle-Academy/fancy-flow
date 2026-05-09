import { useCallback, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import type { FlowEdge, FlowGraph, FlowNode } from "../types";

export type UseFlowStateReturn = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>;
  setEdges: React.Dispatch<React.SetStateAction<FlowEdge[]>>;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  /** Snapshot the current graph (suitable for serialization). */
  toGraph: () => FlowGraph;
};

/**
 * useFlowState — React Flow's standard controlled-state plumbing in one hook.
 * Spread into <FlowCanvas>.
 */
export function useFlowState(initial: FlowGraph): UseFlowStateReturn {
  const [nodes, setNodes] = useState<FlowNode[]>(initial.nodes);
  const [edges, setEdges] = useState<FlowEdge[]>(initial.edges);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns) as FlowNode[]);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
  }, []);
  const onConnect = useCallback((connection: Connection) => {
    setEdges((es) => addEdge(connection, es) as Edge[]);
  }, []);

  const toGraph = useCallback(() => ({ nodes, edges }), [nodes, edges]);

  return { nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, onConnect, toGraph };
}
