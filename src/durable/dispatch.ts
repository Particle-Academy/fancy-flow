/**
 * How many of ONE run's nodes may be held at once, and which ready nodes go next.
 *
 * ## Serial is the default
 *
 * A queued run hands a node to the queue only once the node before it has
 * settled: one node of a run held at a time, in the graph's own declaration
 * order. Parallel dispatch of a ready frontier is something a host ASKS for,
 * with `maxConcurrent` on the {@link Coordinator}.
 *
 * | `maxConcurrent` | meaning |
 * |---|---|
 * | unset | **1**: serial |
 * | `N >= 1` | up to N of the run's nodes held at once |
 * | {@link UNLIMITED_CONCURRENCY} (`0`) | the whole ready frontier |
 * | anything else | refused, by name |
 *
 * A negative number is refused rather than read as "unlimited". Under a serial
 * default, a typo that silently turned a run parallel is the failure to avoid.
 *
 * ## Held means claimed OR paused
 *
 * A node parked on a person keeps its slot. A pause does not park the whole run
 * in this runtime: `advance()` is called whenever any job settles, and without
 * this rule it would hand out the gate's siblings while the person is still
 * deciding.
 *
 * ## Measured against held work, not the batch
 *
 * Two nodes settling at once each trigger an `advance()` on a real queue. A cap
 * applied to one batch would let each of them dispatch its own quota, so the
 * budget is `maxConcurrent - held`, counted off the claim rows.
 *
 * This is the TypeScript member of a three-runtime contract. The
 * `flow/durable-dispatch` conformance suite pins it, and names
 * `fancy-flow-php`'s `DispatchLimit` and the Python runtime's
 * `fancy_flow.durable.select_dispatch` as the other two implementations.
 */

import { NodeRunStatus, type NodeState } from "./state";

/** Dispatch the whole ready frontier. Named so a host never writes a bare `0`. */
export const UNLIMITED_CONCURRENCY = 0;

/** One node of a run held at a time: what an unset `maxConcurrent` means. */
export const DEFAULT_MAX_CONCURRENT = 1;

/**
 * Refuse a limit that is neither a cap nor {@link UNLIMITED_CONCURRENCY}.
 *
 * Thrown where the limit is SET, not where the first `advance()` trips over it
 * on a worker.
 */
export function assertMaxConcurrent(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;

  throw new RangeError(
    `maxConcurrent must be a positive integer, or UNLIMITED_CONCURRENCY (0) for the whole ready ` +
      `frontier, or unset for serial; got ${describe(value)}.`,
  );
}

/**
 * The ready nodes that may be dispatched now, in the order given.
 *
 * `ready` comes from `Frontier.compute`, in declaration order, and that order is
 * kept: this slices, it never sorts. `state` must already include any skips the
 * frontier just settled. Skips are never held, so that changes no count, but the
 * state must describe the run as it is after the decision.
 */
export function selectDispatch(
  ready: readonly string[],
  state: Record<string, NodeState>,
  maxConcurrent: number,
): string[] {
  const limit = assertMaxConcurrent(maxConcurrent);
  if (limit === UNLIMITED_CONCURRENCY) return [...ready];

  let held = 0;
  for (const entry of Object.values(state)) {
    if (entry.status === NodeRunStatus.CLAIMED || entry.status === NodeRunStatus.PAUSED) held++;
  }

  return ready.slice(0, Math.max(0, limit - held));
}

function describe(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return typeof value;
}
