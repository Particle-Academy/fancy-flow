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
 * - every node EXCEPT the target is bound, through `RunOptions.nodeExecutors`,
 *   to a FENCE that runs nothing and publishes only a port no edge reads;
 * - so the engine walks its own topological order, skips its own dead branches,
 *   collects the target's inputs its own way, and runs the target.
 *
 * ## Why the fence does not stop the walk
 *
 * It used to abort the run. The target's own inputs never depend on a fenced
 * node -- the frontier dispatches a node only once every source is settled, and
 * settled sources are resumed, not fenced -- but an UNRELATED node can precede
 * the target in topological order. Two siblings dispatched together are exactly
 * that: when `b`'s job started while `a` was still running, the replay aborted
 * at `a`, never reached `b`, and the coordinator read "the replay ended without
 * running me" as "the engine decided I am unreachable". `b` was recorded
 * skipped, never ran, and the run completed as a success. It did not even take
 * two workers: the frontier lists ready nodes in NODE order and the engine walks
 * EDGE order, so a graph where those disagree about siblings sent in-process
 * `runToCompletion` down the same path.
 *
 * Walking past fences makes that inference honest again: when the replay
 * finishes without an output for the target, it is because the engine found
 * every inbound edge dead.
 *
 * ## Why the fences are not registry entries
 *
 * The registry is one flat object, and a key in it is tried as a node's id AND
 * as its kind. Fencing the node called `host_kind` by writing
 * `executors["host_kind"]` fenced every node of kind `host_kind` too, so a
 * durable run of that graph ran nothing and reported success. And the registry
 * is what `ctx.executors` hands a `subflow` child, so a child node sharing an id
 * with any parent node ran the parent's fence. `nodeExecutors` matches node ids
 * only and is never handed down; the registry reaches the engine untouched.
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
import type { ExecutorRegistry, FlowGraph, NodeExecutor, RunEvent } from "../types";

/**
 * The abort reason a boundary used to report.
 *
 * Nothing aborts with it any more (see "Why the fence does not stop the walk");
 * {@link isBoundary} still recognises it so a caller that checks for it keeps
 * working.
 */
export const BOUNDARY = "fancy-flow:node-boundary";

/**
 * The port a fenced node publishes on. No edge reads it, so everything
 * downstream of a fenced node is dark in the replay -- which never matters to
 * the target, whose sources are all settled.
 */
export const FENCE_PORT = "fancy-flow:fenced";

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
 * Pass `nodeId = null` to PROBE: every node is fenced, so nothing executes and
 * the engine reports only what it can determine structurally — a cycle, and
 * the ports each resumed output republishes on.
 */
export async function replayUpTo(
  graph: FlowGraph,
  nodeId: string | null,
  executors: ExecutorRegistry,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  // The ids a fence actually ran for. A fence executes nothing, so what the
  // engine recorded for these nodes is not an output and is removed below.
  const fencedOff = new Set<string>();
  const fence: NodeExecutor = (ctx) => {
    fencedOff.add(ctx.node.id);
    return { __port: FENCE_PORT, value: null };
  };

  const fences: Record<string, NodeExecutor> = {};
  for (const node of graph.nodes) {
    if (node.id !== nodeId) fences[node.id] = fence;
  }

  const ports: Record<string, string[]> = {};
  const collect = (event: RunEvent): void => {
    if (event.type === "node-output") {
      (ports[event.nodeId] ??= []).push(event.portId);
    }
    options.onEvent?.(event);
  };

  const result = await runFlow(graph, executors, collect, {
    initialInputs: options.initialInputs ?? {},
    resumeOutputs: options.resumeOutputs ?? {},
    depth: options.depth ?? 0,
    run: options.run,
    nodeExecutors: fences,
  });

  for (const id of fencedOff) {
    delete result.outputs[id];
    delete ports[id];
  }

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
