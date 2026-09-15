/**
 * Step-wise execution — one job per node, and nothing waiting on a person.
 *
 * ## What this is for
 *
 * `runFlow` executes a whole graph in one call. That is right for the editor,
 * for a CLI and for a test, and wrong for anything durable: a workflow that
 * pauses for an approval would hold a worker for as long as the person takes to
 * answer, and a worker killed mid-run loses every node that completed during
 * the attempt.
 *
 * This module splits a run into steps. A queue adapter wraps two operations —
 * `advance()` (what is unblocked?) and `runNode()` (claim, execute, checkpoint)
 * — and owns nothing else. The routing rules stay in the engine: `runNode`
 * replays the graph *through* `runFlow`, fenced to one node, with completed
 * nodes fed back as `resumeOutputs`.
 *
 * ```ts
 * import { Coordinator, InMemoryClaimStore } from "@particle-academy/fancy-flow/durable";
 *
 * const runner = new Coordinator({ graph, executors, run: "run_9f2c", store });
 *
 * // In a queue job:  advance -> dispatch one job per id
 * for (const nodeId of await runner.advance()) enqueue(nodeId);
 * // In each node job:
 * const outcome = await runner.runNode(nodeId, jobToken);
 * // ...and when it settles, advance again: that is what hands out the next node.
 * ```
 *
 * ## One node at a time, unless the host asks for more
 *
 * **Serial is the default.** `advance()` returns at most one id, and returns
 * the next only once that node has settled, in the graph's declaration order.
 * Nodes of one run never sit on the queue together.
 *
 * `maxConcurrent` changes that per coordinator. It caps how many of the run's
 * nodes are HELD at once, where held means claimed by a worker or paused on a
 * person. A positive integer is a cap; `UNLIMITED_CONCURRENCY` dispatches the
 * whole ready frontier:
 *
 * ```ts
 * import { Coordinator, UNLIMITED_CONCURRENCY } from "@particle-academy/fancy-flow/durable";
 *
 * new Coordinator({ graph, executors, run, store });                                        // serial
 * new Coordinator({ graph, executors, run, store, maxConcurrent: 4 });                      // up to 4
 * new Coordinator({ graph, executors, run, store, maxConcurrent: UNLIMITED_CONCURRENCY });  // all ready
 * ```
 *
 * `selectDispatch` is the selection on its own, a pure function of the ready ids,
 * the claim rows and the limit, for an adapter that computes the frontier itself.
 *
 * ## A human gate holds nothing
 *
 * `user_input` / `human_approval` fire the request and finish. The node is
 * checkpointed as `paused`, the job returns, the worker moves on. When the
 * person answers, the host records the submission, releases the claim, and
 * calls `advance()` — and *that* is what enqueues the continuation. No worker,
 * connection or process waits on somebody who may not even be logged in.
 *
 * The paused node keeps its dispatch slot until then, so a serial run hands out
 * nothing else while the person decides. Releasing the claim frees the slot,
 * and on a serial run the gate is the first node the next `advance()` returns.
 *
 * ## Parity
 *
 * This is the TypeScript member of a three-runtime design: `fancy-flow-php`'s
 * `per_node` queue driver and `fancy_flow.durable` in the Python runtime are
 * the same model, node for node. See
 * `.ai/plans/fancy-flow-run-identity-and-steps.md`.
 */

export {
  InMemoryClaimStore,
  NodeRunStatus,
  SETTLED,
  isSettled,
  type NodeClaimStore,
  type NodeRunStatusValue,
  type NodeState,
} from "./state";

export { Frontier, type FrontierResult } from "./frontier";

export { UNLIMITED_CONCURRENCY, selectDispatch } from "./dispatch";

export {
  BOUNDARY,
  FENCE_PORT,
  isBoundary,
  replayUpTo,
  type ReplayOptions,
  type ReplayResult,
} from "./replay";

export { RetryPolicy, UNSAFE_TO_REPLAY, type RetryPolicyOptions } from "./retry";

export {
  NotAwaitingHuman,
  Submissions,
  durableApproval,
  durableUserInput,
} from "./human";

export {
  Coordinator,
  type CoordinatorOptions,
  type DurableRunResult,
  type NodeOutcome,
} from "./coordinator";
