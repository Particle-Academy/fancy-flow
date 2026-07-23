import { useCallback, useMemo, useRef, useState } from "react";
import type { EdgeChange, NodeChange } from "@xyflow/react";
import type { FlowGraph } from "../types";
import { createHistory } from "./history";
import type { UseFlowStateReturn } from "./use-flow-state";

export type UseFlowHistoryReturn = {
  /** The flow sink wrapped so committing mutations snapshot for undo first. */
  flow: UseFlowStateReturn;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Snapshot the current graph as an undo point (before a programmatic edit). */
  capture: () => void;
  /** Wire to `<FlowCanvas onNodeDragStart>` — snapshots the pre-drag graph. */
  onNodeDragStart: () => void;
};

/**
 * useFlowHistory — the commit/undo pipeline. Wraps a flow sink (the uncontrolled
 * `useFlowState` hook OR the controlled adapter) so every *committing* mutation
 * records a snapshot first, giving undo/redo without the editor threading
 * history through each call site. This is the single interception point the
 * two-sink architecture otherwise lacks.
 *
 * Granularity: a burst of setState calls from one logical op (e.g. a
 * delete = setNodes+setEdges) is coalesced into ONE undo step; transient
 * interactive changes (drag-move, dimension-measure, selection) are NOT captured
 * — a drag is captured once at `onNodeDragStart` instead.
 */
export function useFlowHistory(flow: UseFlowStateReturn): UseFlowHistoryReturn {
  const history = useRef(createHistory()).current;
  const restoring = useRef(false);
  const coalesced = useRef(false);
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  // Latest graph via a ref, so capture never reads a stale snapshot.
  const graphRef = useRef<FlowGraph>({ nodes: flow.nodes, edges: flow.edges });
  graphRef.current = { nodes: flow.nodes, edges: flow.edges };

  const capture = useCallback(() => {
    if (restoring.current || coalesced.current) return;
    coalesced.current = true;
    queueMicrotask(() => {
      coalesced.current = false;
    });
    history.push(graphRef.current);
    rerender();
  }, [history, rerender]);

  const restore = useCallback(
    (g: FlowGraph | null) => {
      if (!g) return;
      restoring.current = true;
      flow.setGraph(g);
      queueMicrotask(() => {
        restoring.current = false;
      });
      rerender();
    },
    [flow, rerender],
  );

  const undo = useCallback(() => restore(history.undo(graphRef.current)), [history, restore]);
  const redo = useCallback(() => restore(history.redo(graphRef.current)), [history, restore]);

  const wrapped = useMemo<UseFlowStateReturn>(
    () => ({
      ...flow,
      setNodes: (next) => {
        capture();
        flow.setNodes(next);
      },
      setEdges: (next) => {
        capture();
        flow.setEdges(next);
      },
      setGraph: (g) => {
        capture();
        flow.setGraph(g);
      },
      onNodesChange: (changes: NodeChange[]) => {
        // Only structural removes commit; position/dimensions/select are transient.
        if (!restoring.current && changes.some((c) => c.type === "remove")) capture();
        flow.onNodesChange(changes);
      },
      onEdgesChange: (changes: EdgeChange[]) => {
        if (!restoring.current && changes.some((c) => c.type === "remove")) capture();
        flow.onEdgesChange(changes);
      },
      onConnect: (conn) => {
        capture();
        flow.onConnect(conn);
      },
    }),
    [flow, capture],
  );

  return {
    flow: wrapped,
    undo,
    redo,
    canUndo: history.canUndo(),
    canRedo: history.canRedo(),
    capture,
    onNodeDragStart: capture,
  };
}
