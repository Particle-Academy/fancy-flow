/**
 * Which nodes can run RIGHT NOW, given what has already settled.
 *
 * ## Why this is not a second engine
 *
 * `runFlow` walks a Kahn topological order and, at each node, runs it when at
 * least one incoming edge is active. That is a total order because one process
 * executes every node. Split the graph across jobs and the same rule has to be
 * asked the other way round — not "what is next" but "what is unblocked" —
 * which is this module.
 *
 * The rule is the engine's, restated:
 *
 * - every direct predecessor has SETTLED (in topological order the engine has
 *   already settled all of them by the time it reaches a node);
 * - and either the node has no incoming edges, or at least one incoming edge is
 *   ACTIVE — its source completed and published on that edge's source handle.
 *
 * A node whose predecessors have all settled with no active edge is what the
 * engine reports as `idle/skipped`. Skipping SETTLES it, which can in turn
 * unblock — or skip — its own successors, so the pass repeats until nothing
 * changes. That cascade is how a dead branch collapses without leaving the run
 * stuck.
 *
 * ## The one thing it does NOT decide
 *
 * Which ports a result activated. Those rules (`__port`, `branch`, declared
 * outputs, the kind's ports, the `out` fallback) live in the engine and stay
 * there: this reads the ports back off the `node-output` events the engine
 * emitted when the node ran, stored on the claim row.
 */

import { getNodeKind, kindIds } from "../registry/registry";
import type { FlowEdge, FlowGraph } from "../types";
import { NodeRunStatus, isSettled, type NodeClaimStore, type NodeState } from "./state";

export type FrontierResult = {
  ready: string[];
  skipped: string[];
};

function isNote(type: string | undefined): boolean {
  if (!type) return false;
  if (type === "note") return true;
  const kind = getNodeKind(type);
  return kind ? kindIds(kind).includes("note") || kind.category === "annotation" : false;
}

export const Frontier = {
  compute(graph: FlowGraph, state: Record<string, NodeState>): FrontierResult {
    const incoming = new Map<string, FlowEdge[]>();
    for (const edge of graph.edges) {
      const list = incoming.get(edge.target) ?? [];
      list.push(edge);
      incoming.set(edge.target, list);
    }

    // Settled nodes and the ports they lit. A skipped node is settled with NO
    // ports, which is precisely what makes its successors skip too.
    const settled = new Map<string, readonly string[]>();
    const held = new Set<string>();
    for (const [nodeId, entry] of Object.entries(state)) {
      if (entry.status === NodeRunStatus.COMPLETED) settled.set(nodeId, entry.ports);
      else if (isSettled(entry.status)) settled.set(nodeId, []);
      else held.add(nodeId);
    }

    const ready: string[] = [];
    const skipped: string[] = [];

    let changed = true;
    while (changed) {
      changed = false;

      for (const node of graph.nodes) {
        const nodeId = node.id;
        if (settled.has(nodeId) || held.has(nodeId) || ready.includes(nodeId)) continue;

        const edges = incoming.get(nodeId) ?? [];
        let blocked = false;
        let active = false;

        for (const edge of edges) {
          if (!settled.has(edge.source)) {
            blocked = true;
            break;
          }
          // The engine's port key: an edge with no source handle reads the
          // source's `out` port.
          if (settled.get(edge.source)!.includes(edge.sourceHandle ?? "out")) active = true;
        }

        if (blocked) continue;

        // Reached, but down a branch that never lit.
        if (edges.length > 0 && !active) {
          settled.set(nodeId, []);
          skipped.push(nodeId);
          changed = true;
          continue;
        }

        // Annotations and layout are never executed. Settling them here rather
        // than dispatching a job saves a queue round trip per sticky note — and
        // a graph can carry a lot of sticky notes.
        if (isNote(node.type) || getNodeKind(node.type ?? "")?.category === "layout") {
          settled.set(nodeId, []);
          skipped.push(nodeId);
          changed = true;
          continue;
        }

        ready.push(nodeId);
      }
    }

    return { ready, skipped };
  },

  /** Has every node settled? The run is finished when it has. */
  isComplete(graph: FlowGraph, state: Record<string, NodeState>): boolean {
    return graph.nodes.every((node) => isSettled(state[node.id]?.status));
  },

  /**
   * Is any node still held by a worker, or parked for a person?
   *
   * An empty frontier means something different depending on this: with work in
   * flight the run is simply waiting, and whichever job finishes will advance
   * it. With nothing in flight and nodes still unsettled, the graph cannot
   * progress at all — which is a stuck run, and must be reported rather than
   * waited on.
   */
  hasWorkInFlight(state: Record<string, NodeState>): boolean {
    return Object.values(state).some(
      (entry) => entry.status === NodeRunStatus.CLAIMED || entry.status === NodeRunStatus.PAUSED,
    );
  },

  /** Persist the skip cascade so the next pass does not recompute it. */
  async settleSkips(
    store: NodeClaimStore,
    runKey: string,
    skipped: readonly string[],
  ): Promise<void> {
    for (const nodeId of skipped) await store.skip(runKey, nodeId);
  },
};
