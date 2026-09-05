import { getTerminalHost, type TerminalSession, type TerminalSessionSpec } from "../registry/capabilities";
import type { FlowGraph, FlowNode } from "../types";

/**
 * One terminal per terminal lane, for the length of a run.
 *
 * ## The lifetime, and why it is not per-node
 *
 * A terminal node is only useful if the process it talks to is the SAME one the
 * last node talked to. `cd` has to persist; an agent TUI has to still be
 * running with its conversation intact. A session opened per node would give
 * every node a fresh shell and quietly turn a sequence of steps into a series
 * of unrelated ones — each individually correct, the whole thing meaningless.
 *
 * So the session is keyed on the LANE, opened lazily by the first node inside
 * it, and closed once when the run ends. A graph that never reaches a terminal
 * node spawns no process at all, which is what makes it safe for the lane to
 * exist on a canvas that mostly does other things.
 *
 * ## Why membership is `parentId`
 *
 * It is what the canvas already means by "inside", and it already persists into
 * the WorkflowSchema — so a headless runtime resolves exactly the grouping a
 * person drew, with no second association to keep in step. The alternative, a
 * lane id typed into each node's config, is the same fact in two places and
 * would drift the first time somebody dragged a node out of a lane.
 *
 * Nesting is followed to the nearest terminal lane, so an ordinary lane inside
 * a terminal lane still resolves — grouping for looks should not change which
 * terminal a node talks to.
 */
export class TerminalSessions {
  private readonly open = new Map<string, Promise<TerminalSession>>();

  private readonly laneOf = new Map<string, string | null>();

  constructor(private readonly graph: FlowGraph) {}

  /**
   * The terminal lane a node belongs to, or null.
   *
   * Walks up `parentId` rather than checking only the immediate parent, and
   * caches per node id — a graph is walked once per run, and the answer cannot
   * change while it runs.
   */
  laneFor(nodeId: string, isTerminalLane: (node: FlowNode) => boolean): string | null {
    const cached = this.laneOf.get(nodeId);
    if (cached !== undefined) return cached;

    const byId = new Map(this.graph.nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();

    let current = byId.get(nodeId);
    let answer: string | null = null;

    while (current) {
      // A cycle in `parentId` is malformed rather than impossible — a dragged
      // node with a stale parent can produce one — and walking it forever would
      // hang the run rather than fail it.
      if (seen.has(current.id)) break;
      seen.add(current.id);

      if (current.id !== nodeId && isTerminalLane(current)) {
        answer = current.id;
        break;
      }

      const parentId = (current as unknown as { parentId?: string }).parentId;
      current = parentId ? byId.get(parentId) : undefined;
    }

    this.laneOf.set(nodeId, answer);
    return answer;
  }

  /**
   * The session for a lane, opening it on first use.
   *
   * The PROMISE is cached, not the resolved session. Two nodes cannot run
   * concurrently in the current engine, but a caller that awaits a
   * half-finished open would otherwise start a second process — and two shells
   * where a graph says one is the failure this class exists to prevent, arriving
   * only under concurrency and therefore only sometimes.
   */
  session(laneId: string, spec: TerminalSessionSpec): Promise<TerminalSession> {
    const existing = this.open.get(laneId);
    if (existing) return existing;

    const host = getTerminalHost();

    if (!host) {
      // Named as a MISSING HOST rather than a failed open. A node in a terminal
      // lane with no host registered is a configuration problem — the desktop
      // app did not install one — and reporting it as "the terminal failed"
      // sends someone to debug a process that was never started.
      const failed = Promise.reject(
        new Error(
          "No terminal host is registered. A terminal lane needs one — call registerTerminalHost() "
            + "from the desktop app, or install @particle-academy/fancy-flow/terminal/fancy-term-host.",
        ),
      );
      // Cached so every node in the lane fails the same way rather than the
      // first one failing and the rest re-asking a question already answered.
      this.open.set(laneId, failed);
      // Nothing awaits this until a node does; keep node from warning meanwhile.
      failed.catch(() => {});
      return failed;
    }

    const opening = Promise.resolve(host.open(spec));
    this.open.set(laneId, opening);
    opening.catch(() => {});
    return opening;
  }

  /** True once a lane has a session — used to avoid opening one during teardown. */
  isOpen(laneId: string): boolean {
    return this.open.has(laneId);
  }

  /**
   * Close every session this run opened.
   *
   * Every close is attempted even if one throws: a host that fails to close one
   * PTY must not strand the others, which would leave processes alive after the
   * run reported that it had finished. Errors are returned rather than thrown,
   * because teardown runs in a `finally` and throwing there would replace the
   * run's real error with a cleanup error.
   */
  async closeAll(): Promise<Error[]> {
    const errors: Error[] = [];

    for (const [laneId, pending] of this.open) {
      try {
        const session = await pending;
        await session.close();
      } catch (e) {
        errors.push(e instanceof Error ? e : new Error(`${laneId}: ${String(e)}`));
      }
    }

    this.open.clear();
    return errors;
  }
}

/** The spec a terminal lane node declares. */
export function specForLane(lane: FlowNode): TerminalSessionSpec {
  const config = ((lane.data as { config?: Record<string, unknown> } | undefined)?.config ?? {}) as Record<
    string,
    unknown
  >;

  const text = (key: string): string | undefined => {
    const value = config[key];
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const env = config.env;

  return {
    command: text("command"),
    cwd: text("cwd"),
    env:
      env && typeof env === "object" && !Array.isArray(env)
        ? Object.fromEntries(
            Object.entries(env as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
          )
        : undefined,
  };
}
