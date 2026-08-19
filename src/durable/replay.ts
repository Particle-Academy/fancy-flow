/**
 * Run ONE node of a graph — through the real engine, not around it.
 *
 * ## The problem this solves
 *
 * A per-node driver has to hand a node exactly the inputs it would have
 * received mid-run: the right values, on the right target handles, from the
 * right *active* edges. Those rules are the engine's (`collectInputs`,
 * `activatedPorts`, the merge-after-decision contract, the `out` fallbacks),
 * and they are the reason the three runtimes agree. Re-implementing them here
 * would be a second engine wearing a driver's clothes, and the two would drift.
 *
 * ## What it does instead
 *
 * It replays the graph with `runFlow` untouched:
 *
 * - every node already completed is fed back as `resumeOutputs`, so the engine
 *   republishes it on the same ports and routes exactly as it did the first
 *   time;
 * - every node EXCEPT the target is bound, by node id, to a boundary executor
 *   that aborts — and a node-id binding outranks every kind binding and the
 *   `*` fallback, so the fence holds whatever a host registered;
 * - so the engine walks its own topological order, skips its own dead branches,
 *   collects the target's inputs its own way, runs the target — and stops at
 *   the next thing it would have run.
 *
 * The target's output is `result.outputs[nodeId]`, and the ports it activated
 * arrive as the engine's own `node-output` events. Nothing about routing is
 * recomputed here.
 *
 * ## The cost, stated plainly
 *
 * Replaying the completed prefix is O(nodes) per node, so a run is O(nodes²) in
 * bookkeeping. The republish executes nothing — it re-publishes stored values —
 * so for the graph sizes workflows actually have this is noise next to a single
 * queue round trip. It buys exact fidelity to the engine, which is not
 * negotiable, and one implementation of the routing rules instead of two.
 */

import { runFlow, type RunResult } from "../runtime/run-flow";
import type { RunIdentity } from "../runtime/run-identity";
import type { ExecutorRegistry, FlowGraph, RunEvent } from "../types";

/**
 * The abort reason the boundary executor uses.
 *
 * Not a failure: it is the engine telling us it reached a node this job is not
 * responsible for.
 */
export const BOUNDARY = "fancy-flow:node-boundary";

export type ReplayResult = {
  result: RunResult;
  /** node id -> the ports its output activated, from the engine's own events. */
  ports: Record<string, string[]>;
  outputOf(nodeId: string): unknown;
  portsOf(nodeId: string): string[];
};

export type ReplayOptions = {
  resumeOutputs?: Record<string, unknown>;
  initialInputs?: Record<string, Record<string, unknown>>;
  onEvent?: (event: RunEvent) => void;
  depth?: number;
  run?: RunIdentity;
};

/**
 * Replay `graph` up to and through `nodeId`.
 *
 * Pass `nodeId = null` to PROBE: every node is a boundary, so nothing executes
 * and the engine reports only what it can determine structurally — a cycle, and
 * the ports each resumed output republishes on.
 */
export async function replayUpTo(
  graph: FlowGraph,
  nodeId: string | null,
  executors: ExecutorRegistry,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const fenced: ExecutorRegistry = { ...executors };
  for (const node of graph.nodes) {
    if (node.id !== nodeId) {
      fenced[node.id] = (ctx) => ctx.abort(BOUNDARY);
    }
  }

  const ports: Record<string, string[]> = {};
  const collect = (event: RunEvent): void => {
    if (event.type === "node-output") {
      (ports[event.nodeId] ??= []).push(event.portId);
    }
    options.onEvent?.(event);
  };

  const result = await runFlow(graph, fenced, collect, {
    initialInputs: options.initialInputs ?? {},
    resumeOutputs: options.resumeOutputs ?? {},
    depth: options.depth ?? 0,
    run: options.run,
  });

  return {
    result,
    ports,
    outputOf: (id) => result.outputs[id],
    portsOf: (id) => ports[id] ?? [],
  };
}

/** True when a replay ended because it reached a node it does not own. */
export function isBoundary(error: string | null | undefined): boolean {
  return error === BOUNDARY;
}
