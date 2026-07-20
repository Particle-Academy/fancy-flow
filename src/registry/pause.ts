/**
 * The human-pause contract.
 *
 * A workflow that waits for a person is not an error, but it travels the same
 * channel as one: the executor aborts, the engine records a reason string, and
 * the durable runner decides whether that string meant "failed" or "waiting".
 *
 * That seam existed before this module, as two `str_starts_with` checks in the
 * Laravel run job against constants owned by two BUILTIN executors. It worked,
 * and it was invisible: a third-party human-input node had no way to announce
 * that it pauses, and nothing stopped a refactor from removing the mechanism
 * out from under published packages. Reported by the MOIC Suite consumer, who
 * needed exactly that and had to reach for a private constant to get it.
 *
 * So the encoding is now public, typed, and versioned by prefix rather than
 * implied. The wire format stays a plain string on purpose — it survives the
 * existing abort → `RunResult.error` path unchanged, crosses a queue boundary,
 * and decodes identically in PHP, none of which a thrown class would do.
 *
 * @see decodePause — the one function a durable runner needs.
 */

/**
 * What the run is waiting for.
 *
 * `approval` and `input` are the shapes both runtimes ship. The type stays open
 * because the whole point is that a marketplace node can define its own —
 * a signature step, a payment confirmation, a review queue — and a runner that
 * does not recognise one should report it rather than guess.
 */
export type PauseAwaiting = "approval" | "input" | (string & {});

/** A run halted, waiting for a person. */
export type PauseSignal = {
  /** The node that paused — where a submission gets injected on resume. */
  nodeId: string;
  awaiting: PauseAwaiting;
  /**
   * Kind-supplied context for whoever renders the wait — a form schema, the
   * question being asked, a diff to approve. Must be JSON-serializable: it
   * crosses a queue boundary and, for durable runs, a database column.
   */
  detail?: unknown;
};

/** Marks a reason string as a pause rather than a failure. */
export const PAUSE_PREFIX = "fancy-flow:pause:";

/**
 * Reason prefixes shipped before this contract, kept decodable forever.
 *
 * These are what `DurableApprovalExecutor` and `DurableUserInputExecutor`
 * emitted, and they are written into the `error` column of every run that
 * paused under an older version. Dropping them would strand those runs
 * mid-flight — a resume path that only works for new runs is not a resume path.
 */
export const LEGACY_PAUSE_PREFIXES: ReadonlyArray<readonly [string, PauseAwaiting]> = [
  ["awaiting-approval:", "approval"],
  ["awaiting-input:", "input"],
];

/**
 * Encode a pause as the reason string an executor aborts with.
 *
 * The payload is JSON rather than delimited fields because a node id may
 * contain a colon, and a positional encoding that breaks on user data is the
 * kind of bug that only shows up in someone else's graph.
 */
export function encodePause(signal: PauseSignal): string {
  const { nodeId, awaiting, detail } = signal;
  return PAUSE_PREFIX + JSON.stringify(detail === undefined ? { nodeId, awaiting } : { nodeId, awaiting, detail });
}

/**
 * Decode a run's error reason into a pause, or null if it was a real failure.
 *
 * This is the whole contract from a runner's side: call it on `result.error`,
 * and if it returns non-null, persist the run as waiting on `signal.nodeId`
 * instead of failing it. Accepts the legacy prefixes, so a runner written
 * against this handles runs that paused under an older version.
 */
export function decodePause(reason: string | null | undefined): PauseSignal | null {
  if (typeof reason !== "string") return null;

  if (reason.startsWith(PAUSE_PREFIX)) {
    const body = reason.slice(PAUSE_PREFIX.length);
    try {
      const parsed = JSON.parse(body) as Partial<PauseSignal>;
      // A malformed payload is a corrupt pause, not a failure to report as a
      // crash — but it is also not something to invent a node id for.
      if (typeof parsed?.nodeId !== "string" || typeof parsed?.awaiting !== "string") return null;
      return "detail" in parsed
        ? { nodeId: parsed.nodeId, awaiting: parsed.awaiting, detail: parsed.detail }
        : { nodeId: parsed.nodeId, awaiting: parsed.awaiting };
    } catch {
      return null;
    }
  }

  for (const [prefix, awaiting] of LEGACY_PAUSE_PREFIXES) {
    if (reason.startsWith(prefix)) {
      return { nodeId: reason.slice(prefix.length), awaiting };
    }
  }

  return null;
}

/** True when a run's error reason is actually a pause. */
export function isPause(reason: string | null | undefined): boolean {
  return decodePause(reason) !== null;
}

/**
 * Abort the current node as a pause.
 *
 * Called from inside an executor with its own context. Node authors should
 * reach for this rather than hand-encoding a reason, so the format stays ours
 * to change:
 *
 * ```ts
 * const values = ctx.inputs.values;
 * if (values === undefined) pauseForHuman(ctx, "input", { fields });
 * return values;
 * ```
 *
 * Note the `undefined` check — an empty submission (`{}`) is a real answer and
 * must resume. Truthiness here pauses forever on an empty form.
 */
export function pauseForHuman(
  ctx: { node: { id: string }; abort: (reason?: string) => never },
  awaiting: PauseAwaiting,
  detail?: unknown,
): never {
  return ctx.abort(encodePause({ nodeId: ctx.node.id, awaiting, detail }));
}
