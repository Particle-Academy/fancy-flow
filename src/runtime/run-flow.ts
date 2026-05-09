import type {
  ExecutorRegistry,
  FlowEdge,
  FlowGraph,
  FlowNode,
  NodeExecutor,
  RunEvent,
} from "../types";

export type RunOptions = {
  /** Stop the run after this many ms. Default: no timeout. */
  timeoutMs?: number;
  /** Abort signal — host can cancel the run. */
  signal?: AbortSignal;
  /** Initial inputs supplied to entry-point nodes (no incoming edges). */
  initialInputs?: Record<string, Record<string, unknown>>;
};

export type RunResult = {
  ok: boolean;
  /** Outputs collected per node, keyed by node id. */
  outputs: Record<string, unknown>;
  /** Error captured if any node threw. */
  error?: string;
};

/**
 * runFlow — topological execution of a FlowGraph against an ExecutorRegistry.
 *
 * Each node runs once, when all upstream nodes have produced outputs on the
 * connected ports. Decision nodes (or any executor that returns `{ branch:
 * 'true' }`) can short-circuit specific output ports — only edges leaving
 * an "active" port propagate to downstream nodes.
 *
 * Cycles are detected and abort the run with an error.
 *
 * The `onEvent` callback receives a stream of `RunEvent`s — wire it to a
 * status feed, log panel, or store.
 */
export async function runFlow(
  graph: FlowGraph,
  executors: ExecutorRegistry,
  onEvent: (event: RunEvent) => void = () => {},
  options: RunOptions = {},
): Promise<RunResult> {
  const { signal, initialInputs = {}, timeoutMs } = options;
  const outputs: Record<string, unknown> = {};
  const portValues = new Map<string, unknown>(); // key: `${nodeId}:${portId}`
  const completed = new Set<string>();
  const errors: string[] = [];

  // Topological order via Kahn's algorithm. We allow nodes to run as soon
  // as their incoming edges' source ports have produced values, so the
  // order here is just a deterministic baseline used for cycle detection.
  const order = topoSort(graph);
  if (order === null) {
    const msg = "Cycle detected in flow graph — aborting.";
    onEvent({ type: "run-error", error: msg });
    return { ok: false, outputs, error: msg };
  }

  const incomingByNode = indexIncoming(graph.edges);
  const timer = timeoutMs ? setTimeout(() => errors.push(`Run timed out after ${timeoutMs}ms`), timeoutMs) : null;

  onEvent({ type: "run-start" });

  try {
    for (const node of order) {
      if (signal?.aborted) throw new Error("aborted");
      if (errors.length) break;

      const incoming = incomingByNode.get(node.id) ?? [];

      // Skip nodes whose upstream wasn't activated (e.g. a Decision routed
      // to a different branch).
      if (incoming.length > 0) {
        const allActive = incoming.every((e) => portValues.has(`${e.source}:${e.sourceHandle ?? "out"}`));
        if (!allActive) {
          onEvent({ type: "node-status", nodeId: node.id, status: "idle", text: "skipped" });
          continue;
        }
      }

      onEvent({ type: "node-status", nodeId: node.id, status: "running" });

      const inputs = collectInputs(node, incoming, portValues, initialInputs);
      const exec = pickExecutor(executors, node);
      if (!exec) {
        const msg = `No executor registered for kind=${node.type}`;
        errors.push(msg);
        onEvent({ type: "node-status", nodeId: node.id, status: "error", text: msg });
        onEvent({ type: "log", nodeId: node.id, level: "error", message: msg });
        break;
      }

      try {
        const result = await Promise.resolve(
          exec({
            node,
            inputs,
            abort: (reason) => { throw new Error(reason ?? "aborted"); },
            emit: onEvent,
          }),
        );
        outputs[node.id] = result;

        // Decide which output ports were activated. Three conventions:
        //  1) If result is `{ __port: "out", value: x }`, only that port emits.
        //  2) If result has `branch: <portId>`, only that port emits (decision sugar).
        //  3) Otherwise, the value is published on every declared output port.
        const activated = activatedPorts(node, result);
        for (const portId of activated.ports) {
          portValues.set(`${node.id}:${portId}`, activated.value);
          onEvent({ type: "node-output", nodeId: node.id, portId, value: activated.value });
        }
        completed.add(node.id);
        onEvent({ type: "node-status", nodeId: node.id, status: "done" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg);
        onEvent({ type: "node-status", nodeId: node.id, status: "error", text: msg });
        onEvent({ type: "log", nodeId: node.id, level: "error", message: msg });
        break;
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  const ok = errors.length === 0;
  onEvent({ type: "run-end", ok });
  return ok ? { ok, outputs } : { ok, outputs, error: errors[0] };
}

function indexIncoming(edges: FlowEdge[]): Map<string, FlowEdge[]> {
  const map = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    const list = map.get(e.target) ?? [];
    list.push(e);
    map.set(e.target, list);
  }
  return map;
}

function topoSort(graph: FlowGraph): FlowNode[] | null {
  const inDegree = new Map<string, number>();
  for (const n of graph.nodes) inDegree.set(n.id, 0);
  for (const e of graph.edges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  const queue: string[] = [];
  for (const [id, d] of inDegree) if (d === 0) queue.push(id);
  const ordered: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    ordered.push(id);
    for (const e of graph.edges) {
      if (e.source !== id) continue;
      const next = (inDegree.get(e.target) ?? 0) - 1;
      inDegree.set(e.target, next);
      if (next === 0) queue.push(e.target);
    }
  }
  if (ordered.length !== graph.nodes.length) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return ordered.map((id) => byId.get(id)!).filter(Boolean);
}

function collectInputs(
  node: FlowNode,
  incoming: FlowEdge[],
  portValues: Map<string, unknown>,
  initial: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...(initial[node.id] ?? {}) };
  for (const e of incoming) {
    const portId = e.targetHandle ?? "in";
    const val = portValues.get(`${e.source}:${e.sourceHandle ?? "out"}`);
    inputs[portId] = val;
  }
  return inputs;
}

function pickExecutor(
  executors: ExecutorRegistry,
  node: FlowNode,
): NodeExecutor | undefined {
  if (executors[node.id]) return executors[node.id];
  if (node.type && executors[node.type]) return executors[node.type];
  return executors["*"];
}

function activatedPorts(node: FlowNode, result: unknown): { ports: string[]; value: unknown } {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.__port === "string") {
      return { ports: [r.__port], value: r.value };
    }
    if (typeof r.branch === "string") {
      return { ports: [r.branch], value: r.value ?? r };
    }
  }
  const declared = node.data.outputs?.map((p) => p.id) ?? ["out"];
  return { ports: declared, value: result };
}
