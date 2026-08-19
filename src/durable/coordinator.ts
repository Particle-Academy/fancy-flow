/**
 * The per-node driver, with the queue left out.
 *
 * This is the whole of "how a queued run branches", minus the transport. It
 * owns two operations and nothing else:
 *
 * `advance()`
 *   Ask the frontier what is unblocked, settle the skip cascade, and report the
 *   ready node ids. A queue adapter dispatches one job per id.
 *
 * `runNode()`
 *   Claim one node, replay the graph through the real engine fenced to that
 *   node, and checkpoint the output plus the ports the ENGINE said it
 *   activated.
 *
 * Everything a queue library would add — enqueue, retry scheduling, worker
 * lifecycle — sits outside. That separation is the point: it makes the subtle
 * part (which node may run, and with what inputs) testable in-process, with no
 * broker, and identical under every adapter. **A queue adapter therefore
 * contains no workflow logic at all.** That is the test: if an adapter needs to
 * know what a port is, the seam is in the wrong place.
 *
 * `runToCompletion` drives both in one process. It is a real durable runner,
 * not a toy: with a persistent `NodeClaimStore` it survives a crash exactly as
 * a queued run does, because the crash-resume behaviour lives in the
 * checkpoints rather than in the loop.
 *
 * ## No worker waits on a person
 *
 * A human gate returns `paused`. `runToCompletion` returns immediately when it
 * sees one — it does not spin, sleep or poll. The run is parked in the store,
 * the process is free, and a recorded answer is what starts the next job.
 */

import { decodePause, type PauseSignal } from "../registry/pause";
import type { RunResult } from "../runtime/run-flow";
import { RunIdentity, type RunIdentityJson } from "../runtime/run-identity";
import type { ExecutorRegistry, FlowGraph, RunEvent } from "../types";
import { Frontier } from "./frontier";
import { isBoundary, replayUpTo } from "./replay";
import { RetryPolicy } from "./retry";
import {
  InMemoryClaimStore,
  NodeRunStatus,
  type NodeClaimStore,
  type NodeState,
} from "./state";

/** What happened to one node. */
export type NodeOutcome = {
  nodeId: string;
  status: "not-claimed" | "completed" | "skipped" | "failed" | "paused";
  output?: unknown;
  ports?: string[];
  error?: string;
  pause?: PauseSignal;
  /** False when another worker got there first. A lost race is a NO-OP. */
  claimed: boolean;
  /** 1-based attempt this execution ran as. */
  attempt: number;
  /**
   * `true` when this attempt failed and the policy still allows another.
   *
   * The claim row is left CLAIMED in that case, deliberately: a queue adapter
   * re-dispatches the job with the SAME owner token and the retry re-enters the
   * claim it already holds. Recording FAILED here instead would settle the
   * node, which SKIPS everything downstream — a run reporting a tidy finish
   * having done half its work.
   */
  retryable?: boolean;
};

export type DurableRunResult = {
  ok: boolean;
  outputs: Record<string, unknown>;
  error?: string;
  pause?: PauseSignal;
  paused: boolean;
};

export type CoordinatorOptions = {
  graph: FlowGraph;
  executors: ExecutorRegistry;
  /**
   * The run's stable identity. A bare string is taken as the run key.
   *
   * Required — not defaulted. A durable run without a stable key cannot key an
   * idempotent write, and minting one per construction would hand a retrying
   * host a different key each time.
   */
  run: string | RunIdentity | RunIdentityJson;
  store?: NodeClaimStore;
  initialInputs?: Record<string, Record<string, unknown>>;
  retry?: RetryPolicy;
  onEvent?: (event: RunEvent) => void;
};

export class Coordinator {
  readonly graph: FlowGraph;
  readonly executors: ExecutorRegistry;
  readonly run: RunIdentity;
  readonly store: NodeClaimStore;
  readonly initialInputs: Record<string, Record<string, unknown>>;
  readonly retry: RetryPolicy;
  private readonly onEvent?: (event: RunEvent) => void;

  constructor(options: CoordinatorOptions) {
    this.graph = options.graph;
    this.executors = options.executors;
    this.run = RunIdentity.from(options.run);
    this.store = options.store ?? new InMemoryClaimStore();
    this.initialInputs = options.initialInputs ?? {};
    this.retry = options.retry ?? new RetryPolicy();
    this.onEvent = options.onEvent;
  }

  get runKey(): string {
    return this.run.runKey;
  }

  // -- the two operations ----------------------------------------------

  /**
   * Which nodes may be dispatched right now.
   *
   * Also settles the skip cascade, because a skip is a decision the frontier
   * just made and a second caller must not make it again.
   */
  async advance(): Promise<string[]> {
    const frontier = Frontier.compute(this.graph, await this.store.state(this.runKey));
    await Frontier.settleSkips(this.store, this.runKey, frontier.skipped);
    return frontier.ready;
  }

  /**
   * Claim, execute and checkpoint one node.
   *
   * The claim is taken FIRST. Two workers racing for the same node produce one
   * execution and one no-op, and the loser learns that from the store rather
   * than from a duplicate side effect.
   *
   * `owner` is the token that lets a job's own retry re-enter its claim instead
   * of deadlocking against the row it wrote itself — pass the SAME token across
   * a job's attempts.
   */
  async runNode(nodeId: string, owner?: string): Promise<NodeOutcome> {
    const token = owner ?? cryptoRandom();
    if (!(await this.store.claim(this.runKey, nodeId, token))) {
      return { nodeId, status: "not-claimed", claimed: false, attempt: 0 };
    }

    const row = (await this.store.state(this.runKey))[nodeId];
    const identity = this.identityFor(row);

    const replay = await replayUpTo(this.graph, nodeId, this.executors, {
      resumeOutputs: await this.completedOutputs(),
      initialInputs: this.initialInputs,
      onEvent: this.forward(nodeId),
      run: identity,
    });
    const result = replay.result;
    const attempt = identity.attempt;

    if (Object.prototype.hasOwnProperty.call(result.outputs, nodeId)) {
      const output = result.outputs[nodeId];
      const ports = replay.portsOf(nodeId);
      await this.store.complete(this.runKey, nodeId, output, ports);
      return { nodeId, status: "completed", output, ports, claimed: true, attempt };
    }

    // The node did not produce an output. Three reasons, and they are NOT
    // interchangeable.
    const pause = decodePause(result.error);
    if (pause && pause.nodeId === nodeId) {
      await this.store.pause(this.runKey, nodeId, result.error ?? "");
      return { nodeId, status: "paused", pause, claimed: true, attempt };
    }

    if (isBoundary(result.error)) {
      // The engine stopped at a node this job does not own BEFORE reaching the
      // target — so the target was never actually unblocked. That is a frontier
      // bug, not a node failure, and it must not be recorded as one: a FAILED
      // node settles, and settling it would silently skip everything
      // downstream.
      await this.store.skip(this.runKey, nodeId);
      return {
        nodeId,
        status: "skipped",
        error: "replay stopped before reaching this node",
        claimed: true,
        attempt,
      };
    }

    const error = result.error ?? `node ${nodeId} produced no output and no error`;
    const node = this.graph.nodes.find((n) => n.id === nodeId);
    const tries = node ? this.retry.triesFor(node) : 1;

    if (attempt < tries) {
      // Leave the row CLAIMED so the same owner can re-enter it. This is what
      // `fancy-flow-php` does by only marking FAILED from the job's `failed()`
      // hook — the row a worker still holds must not settle mid-retry.
      return { nodeId, status: "failed", error, claimed: true, attempt, retryable: true };
    }

    await this.store.fail(this.runKey, nodeId, error);
    return { nodeId, status: "failed", error, claimed: true, attempt, retryable: false };
  }

  // -- an in-process driver over the two ------------------------------

  /**
   * Drive the graph here, in this process, one node at a time.
   *
   * Every checkpoint is written exactly as a queued run writes it, so a crash
   * mid-loop resumes from the same place a crashed worker would.
   *
   * Retries honour {@link RetryPolicy}: a node declaring `unsafe-to-replay`
   * gets one attempt whatever the policy says, and the retry re-enters the same
   * claim with the same owner token — so the step key it derives is unchanged,
   * which is what makes the retry idempotent rather than duplicative.
   */
  async runToCompletion(maxPasses = 10_000): Promise<DurableRunResult> {
    for (let pass = 0; pass < maxPasses; pass++) {
      const ready = await this.advance();
      if (ready.length === 0) break;

      for (const nodeId of ready) {
        const outcome = await this.runNodeWithRetries(nodeId);

        if (outcome.status === "paused") {
          // A pause parks the RUN, not just the node: continuing would run the
          // human gate's siblings while a person is still deciding. The cohort
          // waits. Nothing here blocks — this RETURNS.
          return {
            ok: false,
            outputs: await this.outputs(),
            pause: outcome.pause,
            paused: true,
          };
        }
        if (outcome.status === "failed") {
          return { ok: false, outputs: await this.outputs(), error: outcome.error, paused: false };
        }
      }
    }

    const state = await this.store.state(this.runKey);
    if (!Frontier.isComplete(this.graph, state)) {
      if (Frontier.hasWorkInFlight(state)) {
        return {
          ok: false,
          outputs: await this.outputs(),
          error: "the run is waiting on work held elsewhere",
          paused: false,
        };
      }
      const unsettled = this.graph.nodes
        .filter((n) => !["completed", "skipped", "failed"].includes(state[n.id]?.status ?? ""))
        .map((n) => n.id);
      return {
        ok: false,
        outputs: await this.outputs(),
        error: `the run cannot progress; unsettled nodes: ${unsettled.join(", ")}`,
        paused: false,
      };
    }

    const failed = Object.values(state)
      .filter((e) => e.status === NodeRunStatus.FAILED)
      .map((e) => e.error ?? "node failed");

    return {
      ok: failed.length === 0,
      outputs: await this.outputs(),
      error: failed[0],
      paused: false,
    };
  }

  /**
   * Checkpointed outputs, in the graph's own node order.
   *
   * Ordered by the graph rather than by completion so two runs of the same
   * workflow produce comparable output maps even when nodes finished in a
   * different order.
   */
  async outputs(): Promise<Record<string, unknown>> {
    const state = await this.store.state(this.runKey);
    const out: Record<string, unknown> = {};
    for (const node of this.graph.nodes) {
      if (state[node.id]?.status === NodeRunStatus.COMPLETED) out[node.id] = state[node.id]!.output;
    }
    return out;
  }

  /** The checkpointed run, in the shape a single-process run returns. */
  async asRunResult(): Promise<RunResult> {
    const outcome = await this.runToCompletion();
    return outcome.error === undefined
      ? { ok: outcome.ok, outputs: outcome.outputs }
      : { ok: outcome.ok, outputs: outcome.outputs, error: outcome.error };
  }

  // -- internals -------------------------------------------------------

  private async runNodeWithRetries(nodeId: string): Promise<NodeOutcome> {
    // One owner token for every attempt of this node — that is what re-enters
    // the claim rather than losing the race to itself, and it is why the step
    // key a retrying node derives is the same one its first attempt sent.
    const owner = cryptoRandom();

    let outcome = await this.runNode(nodeId, owner);
    while (outcome.retryable) {
      outcome = await this.runNode(nodeId, owner);
    }
    return outcome;
  }

  /**
   * The identity handed to the node about to execute.
   *
   * `attempt` and `firstAttemptAt` come off the CLAIM ROW, so they describe
   * this step rather than the run — which is what makes the retry window check
   * exact instead of conservative.
   */
  private identityFor(row: NodeState | undefined): RunIdentity {
    if (!row) return this.run;
    return this.run.withAttempt(row.attempts, row.firstAttemptAt);
  }

  private async completedOutputs(): Promise<Record<string, unknown>> {
    const state = await this.store.state(this.runKey);
    const out: Record<string, unknown> = {};
    for (const [nodeId, entry] of Object.entries(state)) {
      if (entry.status === NodeRunStatus.COMPLETED) out[nodeId] = entry.output;
    }
    return out;
  }

  /**
   * Forward only the events the target node produced.
   *
   * A replay re-emits the whole completed prefix. Passing that through would
   * show a consumer every node running again on every job — the run feed would
   * report a 20-node workflow as 200 status changes.
   */
  private forward(nodeId: string): ((event: RunEvent) => void) | undefined {
    const sink = this.onEvent;
    if (!sink) return undefined;
    return (event) => {
      const id = "nodeId" in event ? event.nodeId : undefined;
      if (id === undefined || id === nodeId) sink(event);
    };
  }
}

function cryptoRandom(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `own_${Math.random().toString(36).slice(2)}${Date.now()}`;
}
