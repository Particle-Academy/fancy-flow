import { useCallback, useRef, useState } from "react";
import { runFlow, type RunOptions, type RunResult } from "./run-flow";
import { getNodeKind } from "../registry/registry";
import type {
  ExecutorRegistry,
  FlowGraph,
  NodeRunStatus,
  RunEvent,
} from "../types";

export type FlowRunFeedEntry = {
  id: string;
  at: number;
  level: "info" | "warn" | "error" | "status";
  text: string;
  nodeId?: string;
  detail?: unknown;
};

export type UseFlowRunReturn = {
  /** Status keyed by nodeId — drive the UI overlay from this. */
  statuses: Record<string, NodeRunStatus>;
  /** Per-node status text (e.g. error message). */
  statusText: Record<string, string | undefined>;
  /** Latest computed output value per node (for reactive kinds). */
  outputs: Record<string, unknown>;
  /** Live event log (capped to last N). */
  feed: FlowRunFeedEntry[];
  /** Whether a run is currently in progress. */
  running: boolean;
  /** Last run result, or null. */
  lastResult: RunResult | null;
  /** Kick off a run with the provided graph + executors. */
  run: (graph: FlowGraph, executors: ExecutorRegistry, options?: RunOptions) => Promise<RunResult>;
  /** Cancel the current run (if any). */
  cancel: () => void;
  /** Reset all runtime state (statuses, feed, lastResult). */
  reset: () => void;
};

export type UseFlowRunOptions = {
  /** Cap the in-memory feed to this many entries. Default 200. */
  maxFeed?: number;
};

/**
 * useFlowRun — drives `runFlow` + maintains observability state. Pair with
 * `applyStatusesToNodes` (below) before passing nodes to `<FlowCanvas>` so
 * the per-node status badge renders.
 */
export function useFlowRun({ maxFeed = 200 }: UseFlowRunOptions = {}): UseFlowRunReturn {
  const [statuses, setStatuses] = useState<Record<string, NodeRunStatus>>({});
  const [statusText, setStatusText] = useState<Record<string, string | undefined>>({});
  const [outputs, setOutputs] = useState<Record<string, unknown>>({});
  const [feed, setFeed] = useState<FlowRunFeedEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleEvent = useCallback(
    (e: RunEvent) => {
      switch (e.type) {
        case "node-status":
          setStatuses((s) => ({ ...s, [e.nodeId]: e.status }));
          setStatusText((t) => ({ ...t, [e.nodeId]: e.text }));
          appendFeed({ level: "status", text: `${e.nodeId} → ${e.status}${e.text ? ` (${e.text})` : ""}`, nodeId: e.nodeId });
          break;
        case "node-output":
          setOutputs((o) => ({ ...o, [e.nodeId]: e.value }));
          appendFeed({ level: "info", text: `${e.nodeId}.${e.portId} = ${preview(e.value)}`, nodeId: e.nodeId, detail: e.value });
          break;
        case "log":
          appendFeed({ level: e.level, text: e.message, nodeId: e.nodeId, detail: e.detail });
          break;
        case "run-start":
          appendFeed({ level: "info", text: "▶ run started" });
          break;
        case "run-end":
          appendFeed({ level: e.ok ? "info" : "error", text: e.ok ? "✓ run complete" : "✗ run failed" });
          break;
        case "run-error":
          appendFeed({ level: "error", text: e.error });
          break;
      }
      function appendFeed(partial: Omit<FlowRunFeedEntry, "id" | "at">) {
        setFeed((f) => {
          const entry: FlowRunFeedEntry = { id: `${Date.now()}_${f.length}`, at: Date.now(), ...partial };
          const next = [...f, entry];
          return next.length > maxFeed ? next.slice(next.length - maxFeed) : next;
        });
      }
    },
    [maxFeed],
  );

  const run = useCallback(
    async (graph: FlowGraph, executors: ExecutorRegistry, options: RunOptions = {}) => {
      if (running) {
        return { ok: false, outputs: {}, error: "another run is already in progress" } satisfies RunResult;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      // Reset previous statuses for the nodes we're about to run.
      const idleStatuses: Record<string, NodeRunStatus> = {};
      for (const n of graph.nodes) idleStatuses[n.id] = "idle";
      setStatuses(idleStatuses);
      setStatusText({});
      setOutputs({});
      setRunning(true);
      try {
        const result = await runFlow(graph, executors, handleEvent, { ...options, signal: controller.signal });
        setLastResult(result);
        return result;
      } finally {
        setRunning(false);
        abortRef.current = null;
      }
    },
    [handleEvent, running],
  );

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    setStatuses({});
    setStatusText({});
    setOutputs({});
    setFeed([]);
    setLastResult(null);
  }, []);

  return { statuses, statusText, outputs, feed, running, lastResult, run, cancel, reset };
}

/**
 * Write each reactive kind's latest run output into its `data.output`, so its
 * card can render the computed value live. Non-reactive kinds are returned
 * untouched. Pair with `applyStatusesToNodes` before rendering.
 */
export function applyOutputsToNodes<TNode extends { id: string; type?: string; data: any }>(
  nodes: TNode[],
  outputs: Record<string, unknown>,
): TNode[] {
  return nodes.map((n) => {
    const kind = getNodeKind((n.data as any)?.kind ?? n.type ?? "");
    if (!kind?.reactive || !(n.id in outputs)) return n;
    return { ...n, data: { ...n.data, output: outputs[n.id] } };
  });
}

/** Merge runtime statuses into nodes for rendering. */
export function applyStatusesToNodes<TNode extends { id: string; data: any }>(
  nodes: TNode[],
  statuses: Record<string, NodeRunStatus>,
  statusText: Record<string, string | undefined>,
): TNode[] {
  return nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      status: statuses[n.id] ?? n.data?.status ?? "idle",
      statusText: statusText[n.id] ?? n.data?.statusText,
    },
  }));
}

function preview(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s && s.length > 60 ? s.slice(0, 57) + "…" : (s ?? String(v));
  } catch {
    return String(v);
  }
}
