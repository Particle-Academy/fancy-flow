/**
 * Who is running, which step this is, and how many times it has been tried.
 *
 * ## Why an engine needs this at all
 *
 * A node that WRITES to somebody else's system — charge a card, send a message,
 * open a pull request — can only survive a retry if the retry carries the same
 * idempotency key the first attempt did. Otherwise the provider treats the
 * second call as a new request and the customer is charged twice.
 *
 * Until this existed the executor context was `{ node, inputs, emit, abort }`,
 * which is not enough to derive one. Both obvious fallbacks are worse than
 * sending no key at all:
 *
 * - **the node id alone** is stable across retries, and also across RUNS — two
 *   legitimate payments share a key and the provider silently collapses the
 *   second into the first. A payment that never happened, reported as success;
 * - **a fresh random value** is unique per run, and also per ATTEMPT — a retry
 *   creates a second charge, which is the thing being avoided.
 *
 * ## What actually identifies a step
 *
 * Not `(run, node)`. A node legitimately executes more than once inside one
 * run: once per subflow invocation, once per iteration of a loop an executor
 * drives itself. `(run, node)` would give every one of those the same key, and
 * a provider would honour exactly one of them.
 *
 * So a step is identified by the **path of invocations that led to it**, plus
 * an optional **occurrence** for repetition at the same level:
 *
 * ```text
 * runKey ":" segment ("/" segment)*        segment := escape(id) ["#" occurrence]
 * ```
 *
 * And the part that is easy to get backwards: **`attempt` is NOT in the key.**
 * It is carried here for logging and for {@link RunIdentity.isReplaySafe}, and
 * putting it in the key would restore the exact bug the key exists to prevent.
 *
 * Pinned cross-runtime by `shared/flow-run-identity` in
 * `@particle-academy/fancy-conformance`.
 */

/** The wire shape — what a queue job payload carries. */
export type RunIdentityJson = {
  runKey: string;
  path?: string[];
  attempt?: number;
  firstAttemptAt?: string;
};

/**
 * Escape one segment so the composition is injective.
 *
 * `%` FIRST, or the escaping is not reversible: escaping `/` before `%` turns a
 * literal `a%2Fb` into the same text as the escaped form of `a/b`, which is the
 * collision this exists to prevent, reintroduced by its own fix.
 */
export function escapeSegment(value: string): string {
  // Not `replaceAll` — the package targets ES2020, and this must produce the
  // identical string on every runtime that reads the conformance table.
  return value.replace(/%/g, "%25").replace(/\//g, "%2F").replace(/#/g, "%23");
}

function renderSegment(value: string, occurrence?: number | null): string {
  const escaped = escapeSegment(value);
  // `occurrence === 0` is a real occurrence. A truthiness check here silently
  // collapses iteration 0 into the un-iterated key.
  return occurrence === undefined || occurrence === null ? escaped : `${escaped}#${occurrence}`;
}

function instant(value: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(
      `RunIdentity: firstAttemptAt is not a parseable timestamp: ${JSON.stringify(value)}`,
    );
  }
  return ms;
}

/**
 * A run, a position inside it, and how many times this position has been tried.
 *
 * Immutable. {@link descend} returns a new identity rather than mutating, so an
 * executor cannot change what its siblings see.
 */
export class RunIdentity {
  /** Stable for the whole run: same across retries, resumes, workers and hosts. */
  readonly runKey: string;

  /**
   * Enclosing invocation segments, outermost first, ALREADY RENDERED.
   *
   * Empty at the top level. A subflow pushes the invoking node's id; an
   * executor that loops pushes `id#i`.
   */
  readonly path: readonly string[];

  /**
   * 1-based attempt of THIS logical step. Never part of the key.
   *
   * The durable driver sets it from the node's claim row, which is exact. A
   * plain in-process `runFlow` gets whatever the host passed, which is
   * run-scoped and therefore conservative — see `isReplaySafe`.
   */
  readonly attempt: number;

  /** ISO-8601 UTC instant of attempt 1 of this step. */
  readonly firstAttemptAt: string;

  constructor(
    runKey: string,
    path: readonly string[] = [],
    attempt = 1,
    firstAttemptAt: string = new Date().toISOString(),
  ) {
    if (!runKey || runKey.trim() === "") {
      throw new Error("RunIdentity: runKey must be a non-empty string.");
    }
    this.runKey = runKey;
    this.path = Object.freeze([...path]);
    this.attempt = Math.max(1, Math.trunc(attempt));
    this.firstAttemptAt = firstAttemptAt;
    Object.freeze(this);
  }

  /**
   * The identity of one execution of one node — stable across retries of that
   * execution, distinct from every other execution of the same node.
   *
   * Pass `occurrence` when an executor runs the same node more than once at the
   * same level (a loop body, one item of a fan-out it drives itself).
   */
  stepKey(nodeId: string, occurrence?: number | null): string {
    return `${this.runKey}:${[...this.path, renderSegment(nodeId, occurrence)].join("/")}`;
  }

  /**
   * A child identity for work nested inside this step.
   *
   * `subflow` pushes the invoking node's id, so a node inside the child graph
   * cannot collide with a same-named node in the parent. Attempt and
   * `firstAttemptAt` are carried down unchanged: the nested work happens inside
   * this step's attempt, and shares its clock.
   */
  descend(segment: string, occurrence?: number | null): RunIdentity {
    return new RunIdentity(
      this.runKey,
      [...this.path, renderSegment(segment, occurrence)],
      this.attempt,
      this.firstAttemptAt,
    );
  }

  /** A copy on a different attempt, first-attempt clock preserved. */
  withAttempt(attempt: number, firstAttemptAt?: string): RunIdentity {
    return new RunIdentity(
      this.runKey,
      this.path,
      attempt,
      firstAttemptAt ?? this.firstAttemptAt,
    );
  }

  /**
   * May this attempt reuse the step key and still be deduplicated?
   *
   * Providers forget idempotency keys — Stripe after 24 hours. Past that
   * window, resending the key creates a second charge and sending a fresh one
   * creates a second charge, so **the caller must refuse rather than pick
   * between them**: a loud stuck run beats a silent double write.
   *
   * `true` on attempt 1 whatever the elapsed time — nothing was sent on an
   * earlier attempt, so there is nothing for the provider to have forgotten.
   * That is what lets a run park on a human gate for a week and then write.
   *
   * `windowSeconds: null` means the provider does not expire keys. `0` means
   * it does not dedupe at all, so no retry may reuse a key — it is a real
   * window, not an absent one, and the two must not be conflated: reading `0`
   * as `null` turns "this provider does not dedupe" into "this provider
   * dedupes forever", which is the more dangerous of the two by a distance.
   */
  isReplaySafe(windowSeconds: number | null | undefined, now: Date | string = new Date()): boolean {
    if (this.attempt <= 1) return true;
    if (windowSeconds === null || windowSeconds === undefined) return true;
    if (windowSeconds <= 0) return false;

    const nowMs = typeof now === "string" ? instant(now) : now.getTime();
    // Clock skew between two workers must not turn a legitimate retry into a
    // refusal, so a negative elapsed clamps to zero.
    const elapsedSeconds = Math.max(0, (nowMs - instant(this.firstAttemptAt)) / 1000);

    // Inclusive: a key written at T is remembered THROUGH T + window.
    return elapsedSeconds <= windowSeconds;
  }

  toJSON(): Required<RunIdentityJson> {
    return {
      runKey: this.runKey,
      path: [...this.path],
      attempt: this.attempt,
      firstAttemptAt: this.firstAttemptAt,
    };
  }

  /** Rebuild from a queue payload. */
  static from(value: RunIdentity | RunIdentityJson | string): RunIdentity {
    if (value instanceof RunIdentity) return value;
    if (typeof value === "string") return new RunIdentity(value);
    return new RunIdentity(
      value.runKey,
      value.path ?? [],
      value.attempt ?? 1,
      value.firstAttemptAt ?? new Date().toISOString(),
    );
  }
}
