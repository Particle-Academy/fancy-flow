import type { ExecutorRegistry, FlowGraph, RunEvent } from "../types";
import { runFlow, type RunOptions, type RunResult } from "./run-flow";

/**
 * How the flows one trigger fired should treat each other.
 *
 * - `serial-guarded` (default) — run in the declared order, one at a time,
 *   re-checking `guard` immediately before each. This is the safe default
 *   because it is the only one that notices when an earlier flow invalidated
 *   the state a later one was fired for.
 * - `serial` — ordered, one at a time, unguarded.
 * - `parallel` — all at once. Ordering is incidental and collisions are yours to
 *   handle; correct for fan-outs that share no state, and only those.
 */
export type CohortPolicy = "serial-guarded" | "serial" | "parallel";

/**
 * The precondition re-checked just before each flow starts.
 *
 * Return `false` (or throw) to skip that flow. The engine cannot know what
 * "still valid" means for your data, so it asks you — right before the run,
 * not at dispatch, because the whole hazard is what changed in between.
 */
export type CohortGuard = (
  flow: FlowGraph,
  index: number,
) => boolean | Promise<boolean>;

export type CohortOptions = RunOptions & {
  policy?: CohortPolicy;
  guard?: CohortGuard;
  /** Why the guard said no — recorded on the skipped result. */
  reason?: (flow: FlowGraph, index: number) => string;
};

export type CohortResult = RunResult & {
  index: number;
  /** True when the flow never ran because its guard did not pass. */
  skipped?: boolean;
  skippedReason?: string;
};

/**
 * runCohort — run every flow that one trigger event fired, as a group.
 *
 * ## Why this exists
 *
 * `runFlow` runs one graph. A host that fans a single webhook, schedule, or
 * record change out to several flows usually loops it — and a loop, or worse a
 * `Promise.all`, has no answer for the case that actually bites: one of those
 * flows deletes or mutates the record they were ALL fired for. The others then
 * run against state that is no longer there and resolve `ok: true`, having done
 * nothing. Nothing throws. Nothing is logged. That silent success is the failure
 * mode this function exists to remove.
 *
 * ## What it does
 *
 * Runs the flows in the order you declared, one at a time, and calls `guard`
 * immediately before each. A flow whose guard does not pass is returned with
 * `skipped: true` and a reason instead of being run — and the cohort carries on
 * to the next one.
 *
 * ```ts
 * const results = await runCohort([enrich, archive, notify], executors, undefined, {
 *   initialInputs: { t: { deal } },          // snapshotted once, shared by all
 *   guard: async () => Boolean(await findDeal(deal.id)),
 *   reason: () => `deal ${deal.id} no longer exists`,
 * });
 * ```
 *
 * If `archive` deletes the deal, `notify` comes back skipped with that reason
 * rather than notifying about nothing.
 *
 * ## Failure does not cancel the cohort
 *
 * A flow that fails is reported and the next one still runs. "The flow before me
 * threw" is not an answer to "is my input still there" — the guard is, and it
 * gets asked either way.
 *
 * The Laravel twin (`FancyFlow::dispatchCohort()` in `fancy-flow-php`) is the
 * same contract across a queue, where each run is durable and hands on to its
 * successor when it settles. Same policies, same guard semantics, same
 * fail-closed rule.
 */
export async function runCohort(
  flows: FlowGraph[],
  executors: ExecutorRegistry,
  onEvent: (event: RunEvent, index: number) => void = () => {},
  options: CohortOptions = {},
): Promise<CohortResult[]> {
  const { policy = "serial-guarded", guard, reason, ...runOptions } = options;

  if (policy === "parallel") {
    return Promise.all(
      flows.map(async (flow, index) => ({
        ...(await runFlow(flow, executors, (e) => onEvent(e, index), runOptions)),
        index,
      })),
    );
  }

  const results: CohortResult[] = [];

  for (const [index, flow] of flows.entries()) {
    if (policy === "serial-guarded" && guard) {
      const why = () => reason?.(flow, index) ?? "trigger precondition no longer holds";
      let passes: boolean;

      try {
        passes = await guard(flow, index);
      } catch (error) {
        // Fail CLOSED. A guard that cannot answer is not permission to proceed:
        // a skip is visible and re-runnable, a run over missing state is neither.
        results.push({
          ok: false,
          outputs: {},
          index,
          skipped: true,
          skippedReason: `guard could not be evaluated: ${errorText(error)}`,
        });
        continue;
      }

      if (!passes) {
        results.push({ ok: false, outputs: {}, index, skipped: true, skippedReason: why() });
        continue;
      }
    }

    results.push({
      ...(await runFlow(flow, executors, (e) => onEvent(e, index), runOptions)),
      index,
    });
  }

  return results;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
