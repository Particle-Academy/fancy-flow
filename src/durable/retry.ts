/**
 * How many times a single node may be attempted.
 *
 * ## Why this cannot be one number
 *
 * A run-wide `tries` setting forces every workflow to pick between two bad
 * answers. At 1, a single flaky LLM or HTTP call takes the whole run down.
 * Above 1, the retry replays from the last checkpoint and everything already
 * done runs again — including the nodes that must not: `git_pr_open` opens a
 * second pull request.
 *
 * Per-node jobs make the question per node, which is where it always belonged.
 * A node declaring `sideEffects: unsafe-to-replay` is pinned to ONE attempt and
 * no backoff. Everything else takes the configured tries, or a per-kind
 * override.
 *
 * Undeclared side effects are treated as the configured default rather than
 * assumed safe: this decides retries, and inventing a safety claim on a node
 * author's behalf is how a retry loop ends up posting the same webhook twice.
 */

import { getNodeKind, kindIds, resolveKindId } from "../registry/registry";
import type { FlowNode } from "../types";

/** A node that is not safe to run twice. Same vocabulary as the node manifest. */
export const UNSAFE_TO_REPLAY = "unsafe-to-replay";

export type RetryPolicyOptions = {
  tries?: number;
  backoffSeconds?: number;
  /** kind id -> tries. Keyed by any spelling; every id is checked. */
  perKind?: Record<string, number>;
};

export class RetryPolicy {
  readonly tries: number;
  readonly backoffSeconds: number;
  readonly perKind: Record<string, number>;

  constructor(options: RetryPolicyOptions = {}) {
    this.tries = options.tries ?? 1;
    this.backoffSeconds = options.backoffSeconds ?? 0;
    this.perKind = options.perKind ?? {};
  }

  triesFor(node: FlowNode): number {
    if (RetryPolicy.isUnsafeToReplay(node)) return 1;

    for (const id of idsFor(node)) {
      if (id in this.perKind) return Math.max(1, Math.trunc(this.perKind[id]!));
    }

    return Math.max(1, Math.trunc(this.tries));
  }

  backoffFor(node: FlowNode): number {
    // Nothing to back off from: the node gets one attempt.
    if (RetryPolicy.isUnsafeToReplay(node)) return 0;
    return Math.max(0, this.backoffSeconds);
  }

  static isUnsafeToReplay(node: FlowNode): boolean {
    if (!node.type) return false;
    return getNodeKind(node.type)?.sideEffects === UNSAFE_TO_REPLAY;
  }
}

/**
 * Every id a per-kind override for this node could be keyed under.
 *
 * Canonical ids are namespaced while a host almost certainly writes the bare
 * one; keying on only the literal string would make the override silently stop
 * applying the day a kind is renamed.
 */
function idsFor(node: FlowNode): string[] {
  if (!node.type) return [];
  const kind = getNodeKind(node.type);
  const canonical = resolveKindId(node.type);
  const ordered = [node.type, ...(canonical ? [canonical] : []), ...(kind ? kindIds(kind) : [])];
  return [...new Set(ordered)];
}
