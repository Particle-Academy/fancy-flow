import type { FlowGraph } from "../types";

/**
 * Undo/redo history — a pure, React-free snapshot controller. The editor pushes
 * a graph snapshot BEFORE each committing mutation; `undo`/`redo` swap snapshots
 * between the past/future stacks. Kept free of React so it can be unit-tested
 * and reused by any host (or a headless driver).
 *
 * Coalescing (collapsing a burst of setState calls from one logical op into a
 * single undo step) is the caller's job — see `useFlowHistory`.
 */
export type HistoryController = {
  /** Record `graph` as an undo point. Clears the redo stack (new branch). */
  push: (graph: FlowGraph) => void;
  /** Pop the last undo point; `current` is pushed onto the redo stack. */
  undo: (current: FlowGraph) => FlowGraph | null;
  /** Pop the last redo point; `current` is pushed back onto the undo stack. */
  redo: (current: FlowGraph) => FlowGraph | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
  /** Test/inspection helper — sizes of the two stacks. */
  size: () => { past: number; future: number };
};

export function createHistory(limit = 100): HistoryController {
  let past: FlowGraph[] = [];
  let future: FlowGraph[] = [];

  return {
    push(graph) {
      past.push(graph);
      if (past.length > limit) past.shift();
      future = [];
    },
    undo(current) {
      const prev = past.pop();
      if (prev === undefined) return null;
      future.push(current);
      return prev;
    },
    redo(current) {
      const next = future.pop();
      if (next === undefined) return null;
      past.push(current);
      return next;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    clear() {
      past = [];
      future = [];
    },
    size: () => ({ past: past.length, future: future.length }),
  };
}
