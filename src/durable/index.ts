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
 * ```
 *
 * ## A human gate holds nothing
 *
 * `user_input` / `human_approval` fire the request and finish. The node is
 * checkpointed as `paused`, the job returns, the worker moves on. When the
 * person answers, the host records the submission, releases the claim, and
 * calls `advance()` — and *that* is what enqueues the continuation. No worker,
 * connection or process waits on somebody who may not even be logged in.
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

export { BOUNDARY, isBoundary, replayUpTo, type ReplayOptions, type ReplayResult } from "./replay";

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
