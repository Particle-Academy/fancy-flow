import type { LiveContract } from "@particle-academy/fancy-query";

/**
 * The fancy-flow Live Contract — the run / job stream shape.
 *
 * Pure data, with `LiveContract` imported as a TYPE, so this adds no dependency.
 * `FancyFlow\Laravel\LiveContract` declares the identical list and both sides
 * assert parity.
 *
 * ## What makes this shape different
 *
 * A run emits far more than it stores. `NodeStatusChanged` and `NodeOutput`
 * fire per node, many times a second on a wide graph — and a node's log line is
 * not a cache entry, it is a **stream**. So the contract covers the run's
 * DURABLE state (does this run exist, has it finished, is it waiting on a
 * person) and deliberately leaves per-node chatter to `useFancyStream`, the
 * same split the whiteboard makes between its document and its cursors.
 *
 * Get that wrong and a 40-node run invalidates the run list forty times while
 * it executes, each one a re-fetch that tells the UI nothing it did not already
 * learn from the stream.
 *
 * ## `awaiting` is the one that matters
 *
 * A run parking on a human step is the event a host most needs to react to —
 * it is when a form has to appear in front of somebody. It gets its own event
 * rather than folding into `updated`, so a host can subscribe to just that.
 *
 * ## Broadcast status, stated plainly
 *
 * `fancy-flow-php` currently dispatches these as **in-process Laravel events**;
 * none of them implement `ShouldBroadcast` yet. This contract is therefore the
 * agreed vocabulary rather than a description of traffic already on the wire: a
 * host that wants live runs today re-broadcasts these under these names. Making
 * the PHP events broadcast natively is a separate change, because it turns on
 * websocket traffic for every consumer.
 */
export const flowLive = {
    namespace: "flow",
    events: [
        { event: "flow.run.created", keys: [["flow", "runs"]] },
        { event: "flow.run.updated", keys: [["flow", "runs"]] },
        { event: "flow.run.completed", keys: [["flow", "runs"]] },
        {
            event: "flow.run.awaiting",
            keys: [["flow", "runs"]],
            note: "A run parking on a human step — the moment a form has to appear in front of somebody. Its own event so a host can subscribe to just that, rather than filtering every update.",
        },
        {
            event: "flow.run.failed",
            keys: [["flow", "runs"]],
            note: "Not one of the standard verbs: a failed run is a terminal state a host renders differently from a completed one, so collapsing the two would lose the distinction.",
        },
    ],
} as const satisfies LiveContract;

/**
 * Per-run keys, for a host showing a single run rather than the list.
 *
 * The contract declares prefixes because it is static data and a run id is not
 * known until runtime. TanStack matches by prefix, so `["flow", "runs"]` still
 * invalidates `["flow", "runs", runId]`.
 */
export const flowKeys = {
    runs: () => ["flow", "runs"] as const,
    run: (runId: string) => ["flow", "runs", runId] as const,
} as const;
