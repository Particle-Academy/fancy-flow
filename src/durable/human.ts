/**
 * Human gates that cannot be walked past — and that hold no worker.
 *
 * ## The directive these implement
 *
 * A node that waits on a person must not occupy a worker, a connection or a
 * process while it waits. So the job for a human gate does its work by
 * **emitting the request** and then **finishing**: the run is persisted as
 * parked, the job returns, the worker takes the next thing off the queue. When
 * the person answers, *that* enqueues the continuation.
 *
 * Mechanically the gate aborts with an encoded pause, which is a *return*, not
 * a block. Nothing in this file sleeps, polls or awaits a person.
 *
 * ## Fail closed, and why
 *
 * A gate pauses because it **is** a human node, not because its input port
 * happens to be empty. This is not a preference; it is a fix. Both peer
 * runtimes once decided whether to pause by reading their own input, so a
 * pre-filled `values` or `approved` value ran the flow straight past the person
 * it was waiting for — silently, with the run reporting success.
 *
 * Restoring the old behaviour is possible, explicit, and per node:
 * `autoAnswerFromInput`. Turn it on for a step that is a form when a human is
 * present and a pass-through when an upstream node already produced the answer.
 * On an approval node, weigh it harder: it means the graph, not a person, can
 * approve.
 *
 * ## The other half of the fix
 *
 * Recording an answer for a node the run is not parked on THROWS rather than
 * queueing a write nobody reads. See {@link Submissions.record}.
 */

import { pauseForHuman } from "../registry/pause";
import { truthy } from "../expressions/expr";
import type { NodeExecutor } from "../types";

/** An answer was recorded for a node the run is not waiting on. */
export class NotAwaitingHuman extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotAwaitingHuman";
  }
}

/**
 * Answers recorded for human gates, keyed by node id.
 *
 * Deliberately separate from the run's inputs. Keeping them in one bag is
 * precisely what let a pre-filled input satisfy a gate.
 */
export class Submissions {
  private readonly answers = new Map<string, unknown>();
  /** The node the run is currently parked on, if any. */
  awaiting: string | null = null;

  /**
   * Record an answer for the node the run is parked on.
   *
   * Throws when the run is not waiting on that node. A queued answer for a node
   * that never paused is a write nobody reads — and it looks, from the outside,
   * exactly like a submission that worked.
   */
  record(nodeId: string, value: unknown): void {
    if (this.awaiting !== null && this.awaiting !== nodeId) {
      throw new NotAwaitingHuman(
        `This run is waiting on "${this.awaiting}", not "${nodeId}". Recording an answer for a ` +
          "node the run is not parked on would be stored and never read.",
      );
    }
    if (this.awaiting === null) {
      throw new NotAwaitingHuman(
        `This run is not waiting for anyone, so an answer for "${nodeId}" has nothing to resume.`,
      );
    }
    this.answers.set(nodeId, value);
    this.awaiting = null;
  }

  answered(nodeId: string): boolean {
    return this.answers.has(nodeId);
  }

  answer(nodeId: string): unknown {
    return this.answers.get(nodeId);
  }

  park(nodeId: string): void {
    this.awaiting = nodeId;
  }
}

function option(ctx: { node: { data?: unknown } }, key: string, fallback?: unknown): unknown {
  const config = ((ctx.node.data as any)?.config ?? {}) as Record<string, unknown>;
  return config[key] ?? fallback;
}

/** `user_input` — pauses until a submission for THIS node is recorded. */
export function durableUserInput(submissions: Submissions): NodeExecutor {
  return (ctx) => {
    if (submissions.answered(ctx.node.id)) return submissions.answer(ctx.node.id);

    if (option(ctx, "autoAnswerFromInput") === true) {
      const values = (ctx.inputs as Record<string, unknown>).values;
      if (values !== undefined) return values;
    }

    submissions.park(ctx.node.id);
    // Emits the request and RETURNS. A host listening to the feed sends the
    // email; the worker is free the moment this throws.
    return pauseForHuman(ctx, "input", {
      title: option(ctx, "title", "Need your input"),
      fields: option(ctx, "fields", []),
    });
  };
}

/** `human_approval` — pauses until a decision for THIS node is recorded. */
export function durableApproval(submissions: Submissions): NodeExecutor {
  return (ctx) => {
    const passthrough = (ctx.inputs as Record<string, unknown>).in ?? ctx.inputs;

    if (submissions.answered(ctx.node.id)) {
      return { branch: truthy(submissions.answer(ctx.node.id)) ? "approved" : "denied", value: passthrough };
    }

    if (option(ctx, "autoAnswerFromInput") === true) {
      const decision = (ctx.inputs as Record<string, unknown>).approved;
      if (decision !== undefined) {
        return { branch: truthy(decision) ? "approved" : "denied", value: passthrough };
      }
    }

    submissions.park(ctx.node.id);
    return pauseForHuman(ctx, "approval", {
      title: option(ctx, "title", "Approve action"),
      description: option(ctx, "description"),
    });
  };
}
