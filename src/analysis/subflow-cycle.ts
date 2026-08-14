import type { FlowGraph } from "../types";
import { isResolutionFailure, type WorkflowResolver } from "../registry/capabilities";

/**
 * Find a `subflow` loop BEFORE the graph is saved, rather than after a run has
 * already done the work N times.
 *
 * ## Why this is not the depth cap
 *
 * `subflowExecutor` caps recursion depth at runtime, which is the correct
 * backstop and stays — it is the only thing that catches a loop created from the
 * other end, when someone edits B after A was saved. But by the time it fires,
 * every node ABOVE the subflow has run on each pass, side effects included, and
 * the author is handed an opaque failure from deep inside a run while the graph
 * that caused it is still saved and still runnable.
 *
 * The editor is where an author would most naturally be stopped, which is why
 * this lives here and not only in the PHP runtime.
 *
 * ## Why it needs a resolver
 *
 * Schema validation checks one graph in isolation and cannot see A → B → A,
 * because each graph is individually valid. Only the resolver knows what a ref
 * points at, and only the host has one.
 *
 * The chain matters more than the boolean: "this loops" is much less useful than
 * naming the step that closes it.
 *
 * The TS twin of `FancyFlow\Analysis\SubflowCycle`.
 *
 * ```ts
 * const loop = await findSubflowCycle(graph, resolver, "Daily Planner");
 * // ["Daily Planner", "Digest", "Daily Planner"]  — or [] when safe
 * ```
 */
export async function findSubflowCycle(
  graph: FlowGraph,
  resolver: WorkflowResolver,
  rootRef?: string,
): Promise<string[]> {
  return walk(
    graph,
    resolver,
    rootRef === undefined ? [] : [rootRef],
    rootRef === undefined ? new Set<string>() : new Set([key(rootRef, undefined)]),
  );
}

async function walk(
  graph: FlowGraph,
  resolver: WorkflowResolver,
  path: string[],
  onPath: Set<string>,
): Promise<string[]> {
  for (const [ref, version] of references(graph?.nodes ?? [])) {
    const k = key(ref, version);

    // Membership is tracked PER PATH, not globally: a diamond (two branches
    // that both call the same child) revisits a ref without looping, and
    // treating that as a cycle would refuse a perfectly good graph.
    if (onPath.has(k)) return [...path, ref];

    const resolved = await resolver(ref, version);

    // A ref that does not resolve is a different problem, reported elsewhere.
    // Refusing the save for it would block authoring a parent before its child
    // exists.
    if (!resolved || isResolutionFailure(resolved)) continue;

    const found = await walk(
      resolved as FlowGraph,
      resolver,
      [...path, ref],
      new Set(onPath).add(k),
    );
    if (found.length) return found;
  }

  return [];
}

/**
 * Every subflow reference reachable from these nodes without leaving the graph —
 * which includes those nested inside an inline `subgraph`, whose graph lives in
 * node config rather than behind a ref.
 */
function references(nodes: readonly unknown[]): Array<[string, number | undefined]> {
  const found: Array<[string, number | undefined]> = [];

  for (const raw of nodes) {
    const n = raw as { type?: string; data?: { kind?: string; config?: Record<string, unknown> } };
    // Same precedence the runner uses to pick an executor.
    const kind = kindName(String(n?.data?.kind ?? n?.type ?? ""));
    const config = (n?.data?.config ?? {}) as Record<string, unknown>;

    if (kind === "subflow") {
      const ref = String(config.workflow ?? "").trim();
      if (ref) found.push([ref, version(config.version)]);
      continue;
    }

    if (kind === "subgraph") {
      // Cannot cycle by itself — it embeds a graph rather than naming one — but
      // a `subflow` inside it can, and a walker that only read top-level nodes
      // would never see it.
      const nested = (config.graph as { nodes?: unknown[] } | undefined)?.nodes;
      if (Array.isArray(nested)) found.push(...references(nested));
    }
  }

  return found;
}

/**
 * Kind ids are namespaced (`@particle-academy/subflow`) with bare aliases
 * (`subflow`), and graphs in the wild carry both. Matching one spelling would
 * silently stop seeing half of them.
 */
function kindName(type: string): string {
  const slash = type.lastIndexOf("/");
  return slash === -1 ? type : type.slice(slash + 1);
}

/** Mirrors the executor's pin rules; anything unusable is treated as unpinned. */
function version(pin: unknown): number | undefined {
  if (pin === undefined || pin === null || pin === "") return undefined;
  const n = Number(pin);
  return Number.isInteger(n) ? n : undefined;
}

/**
 * A pinned ref is a DIFFERENT interface from the same ref unpinned, or from
 * another pin of it — so `A@1 → A@2` is not a loop on its own. Collapsing them
 * would refuse a legitimate "call the previous version" graph.
 */
function key(ref: string, v: number | undefined): string {
  return v === undefined ? ref : `${ref}@${v}`;
}
