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
  /**
   * Replace nodes AND edges atomically in a single commit. Use this for any op
   * that touches both (delete-with-edge-prune, undo/redo restore, setGraph):
   * calling `setNodes` then `setEdges` is NOT atomic in controlled mode (each
   * closes over a stale `value`), so the second write clobbers the first.
   */
  setGraph: (graph: FlowGraph) => void;
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

  const setGraph = useCallback((graph: FlowGraph) => {
    // Two useState writes in one event are batched, so this IS atomic here.
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, []);

  const toGraph = useCallback(() => ({ nodes, edges }), [nodes, edges]);

  return { nodes, edges, setNodes, setEdges, setGraph, onNodesChange, onEdgesChange, onConnect, toGraph };
}
