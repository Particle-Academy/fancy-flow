/**
 * What a durable run remembers, and the seam a real database plugs into.
 *
 * A durable run is bookkeeping plus one hard requirement: **the claim is a
 * unique constraint, not a check.** Two workers racing for the same node must
 * produce a no-op, not a double run, and only the storage layer can promise
 * that. So {@link NodeClaimStore} is an interface with exactly the operations a
 * driver needs, and an adapter implements it over `INSERT … ON CONFLICT DO
 * NOTHING` (or its dialect's spelling).
 *
 * {@link InMemoryClaimStore} is the reference implementation and is genuinely
 * useful: it makes the whole per-node driver testable, and it is correct for a
 * single-process durable run.
 *
 * This is a port of `fancy_flow.durable.state`, which is itself the Python twin
 * of `fancy-flow-php`'s `NodeClaims` + `workflow_run_nodes`. Three runtimes,
 * one design — see `.ai/plans/fancy-flow-run-identity-and-steps.md`.
 */

/** Where one node of one run has got to. */
export const NodeRunStatus = {
  CLAIMED: "claimed",
  COMPLETED: "completed",
  SKIPPED: "skipped",
  FAILED: "failed",
  PAUSED: "paused",
} as const;

export type NodeRunStatusValue = (typeof NodeRunStatus)[keyof typeof NodeRunStatus];

/**
 * A node the frontier may treat as decided.
 *
 * A FAILED node is settled too — it will never publish, so its successors skip
 * rather than wait forever.
 */
export const SETTLED: readonly NodeRunStatusValue[] = [
  NodeRunStatus.COMPLETED,
  NodeRunStatus.SKIPPED,
  NodeRunStatus.FAILED,
];

/**
 * One node's row.
 *
 * `ports` are the ports the engine's own `node-output` events reported. They
 * are STORED, never recomputed: a second copy of the routing table would agree
 * for a year and then disagree on one branch.
 */
export type NodeState = {
  status: NodeRunStatusValue;
  ports: readonly string[];
  output?: unknown;
  error?: string | null;
  owner?: string | null;
  /** 1-based, incremented when an owner re-enters its own claim. */
  attempts: number;
  /** ISO-8601 UTC of the FIRST claim. Never updated — it is the retry clock. */
  firstAttemptAt: string;
};

/**
 * The persistence a per-node driver needs.
 *
 * Six operations. An adapter over Postgres, SQLite or Redis implements these
 * and nothing else; every rule about WHICH node may run lives in `frontier.ts`,
 * which reads only {@link state}.
 */
export interface NodeClaimStore {
  /**
   * Take exclusive ownership of one node of one run.
   *
   * MUST be atomic against concurrent callers, and MUST return `true` for a
   * caller re-entering its OWN claim — that is what lets a job's retry resume
   * instead of deadlocking against the row it wrote itself.
   */
  claim(runKey: string, nodeId: string, owner: string): boolean | Promise<boolean>;
  state(runKey: string): Record<string, NodeState> | Promise<Record<string, NodeState>>;
  complete(
    runKey: string,
    nodeId: string,
    output: unknown,
    ports: readonly string[],
  ): void | Promise<void>;
  skip(runKey: string, nodeId: string): void | Promise<void>;
  fail(runKey: string, nodeId: string, error: string): void | Promise<void>;
  pause(runKey: string, nodeId: string, reason: string): void | Promise<void>;
}

/**
 * A correct, single-process {@link NodeClaimStore}.
 *
 * JavaScript's single-threaded event loop makes the claim atomic for free —
 * there is no interleaving point inside a synchronous method. It is NOT durable
 * across a restart, which is the honest limit: use it for tests, for a CLI run,
 * and for a worker that genuinely owns the whole run.
 */
export class InMemoryClaimStore implements NodeClaimStore {
  private readonly runs = new Map<string, Map<string, NodeState>>();

  claim(runKey: string, nodeId: string, owner: string): boolean {
    const run = this.run(runKey);
    const existing = run.get(nodeId);

    if (!existing) {
      run.set(nodeId, {
        status: NodeRunStatus.CLAIMED,
        ports: [],
        owner,
        attempts: 1,
        firstAttemptAt: new Date().toISOString(),
      });
      return true;
    }

    // Re-entering our own claim is how a retry gets back in. Anything else —
    // another owner, or a settled node — is a lost race, and a lost race is a
    // NO-OP rather than a duplicate run.
    const ownClaim =
      (existing.status === NodeRunStatus.CLAIMED || existing.status === NodeRunStatus.PAUSED) &&
      existing.owner === owner;

    if (ownClaim) {
      existing.attempts += 1;
      existing.status = NodeRunStatus.CLAIMED;
      return true;
    }
    return false;
  }

  state(runKey: string): Record<string, NodeState> {
    const out: Record<string, NodeState> = {};
    for (const [nodeId, entry] of this.run(runKey)) out[nodeId] = { ...entry, ports: [...entry.ports] };
    return out;
  }

  complete(runKey: string, nodeId: string, output: unknown, ports: readonly string[]): void {
    const entry = this.entry(runKey, nodeId);
    entry.status = NodeRunStatus.COMPLETED;
    entry.output = output;
    entry.ports = [...ports];
    entry.error = null;
  }

  skip(runKey: string, nodeId: string): void {
    const entry = this.entry(runKey, nodeId);
    entry.status = NodeRunStatus.SKIPPED;
    entry.ports = [];
  }

  fail(runKey: string, nodeId: string, error: string): void {
    const entry = this.entry(runKey, nodeId);
    entry.status = NodeRunStatus.FAILED;
    entry.error = error;
    entry.ports = [];
  }

  pause(runKey: string, nodeId: string, reason: string): void {
    const entry = this.entry(runKey, nodeId);
    entry.status = NodeRunStatus.PAUSED;
    entry.error = reason;
    entry.ports = [];
  }

  /**
   * Drop a paused node's claim so a recorded answer can re-run it.
   *
   * Not part of the interface: resuming a human gate is the host's decision and
   * its storage's business. Provided here because the in-memory store is also
   * what the tests resume through.
   */
  release(runKey: string, nodeId: string): void {
    this.run(runKey).delete(nodeId);
  }

  private run(runKey: string): Map<string, NodeState> {
    let run = this.runs.get(runKey);
    if (!run) {
      run = new Map();
      this.runs.set(runKey, run);
    }
    return run;
  }

  /** The row for one node, created as CLAIMED if a driver never claimed it. */
  private entry(runKey: string, nodeId: string): NodeState {
    const run = this.run(runKey);
    let entry = run.get(nodeId);
    if (!entry) {
      entry = {
        status: NodeRunStatus.CLAIMED,
        ports: [],
        attempts: 1,
        firstAttemptAt: new Date().toISOString(),
      };
      run.set(nodeId, entry);
    }
    return entry;
  }
}

export function isSettled(status: string | undefined): boolean {
  return status !== undefined && (SETTLED as readonly string[]).includes(status);
}
