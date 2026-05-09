/**
 * Public domain types for fancy-flow. Built-in nodes are layered on top of
 * @xyflow/react's `Node` so consumers can mix custom xyflow nodes alongside
 * the kit. Edges remain xyflow's standard `Edge`.
 */

import type { Edge, Node } from "@xyflow/react";

export type FlowNodeKind =
  | "trigger"
  | "action"
  | "decision"
  | "output"
  | "note"
  | "subgraph";

/** Status surfaced on the node while a run is in progress. */
export type NodeRunStatus = "idle" | "queued" | "running" | "done" | "error";

/** Port description on a node. Ports are visual handles xyflow can connect. */
export type PortDescriptor = {
  id: string;
  label?: string;
  /** Optional logical type for hosts that want to validate connections. */
  type?: string;
};

/** Common shape every kit node carries in its `data` slot. */
export type BaseNodeData = {
  label: string;
  description?: string;
  /** Free-form configuration the host owns (form values, code, parameters). */
  config?: Record<string, unknown>;
  /** Set by the runner; hosts shouldn't edit this directly. */
  status?: NodeRunStatus;
  /** Optional human-readable status detail (e.g. error message, current step). */
  statusText?: string;
  /** Per-node accent override, e.g. for theming a custom subclass. */
  color?: string;
  /** Input ports rendered on the node. Defaults vary by kind. */
  inputs?: PortDescriptor[];
  /** Output ports rendered on the node. Defaults vary by kind. */
  outputs?: PortDescriptor[];
};

export type TriggerNodeData = BaseNodeData & { kind: "trigger" };
export type ActionNodeData = BaseNodeData & { kind: "action" };
export type DecisionNodeData = BaseNodeData & { kind: "decision" };
export type OutputNodeData = BaseNodeData & { kind: "output" };
export type NoteNodeData = BaseNodeData & { kind: "note"; body?: string };
export type SubgraphNodeData = BaseNodeData & {
  kind: "subgraph";
  /** Ids of the nodes contained in this subgraph. */
  childIds?: string[];
  /** Whether the subgraph is shown collapsed (default true — children hidden). */
  collapsed?: boolean;
};

export type FlowNodeData =
  | TriggerNodeData
  | ActionNodeData
  | DecisionNodeData
  | OutputNodeData
  | NoteNodeData
  | SubgraphNodeData;

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge;

/** A serializable graph — what hosts persist, what agents read/write. */
export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
};

/** Per-node executor signature. Inputs are keyed by input-port id. */
export type NodeExecutor<TIn = Record<string, unknown>, TOut = unknown> = (
  ctx: {
    node: FlowNode;
    inputs: TIn;
    /** Stops the run if called. */
    abort: (reason?: string) => never;
    /** Lets the executor stream status updates and partial outputs. */
    emit: (event: RunEvent) => void;
  },
) => Promise<TOut> | TOut;

export type ExecutorRegistry = Partial<Record<FlowNodeKind | string, NodeExecutor>>;

export type RunEvent =
  | { type: "node-status"; nodeId: string; status: NodeRunStatus; text?: string }
  | { type: "node-output"; nodeId: string; portId: string; value: unknown }
  | { type: "log"; nodeId?: string; level: "info" | "warn" | "error"; message: string; detail?: unknown }
  | { type: "run-start" }
  | { type: "run-end"; ok: boolean }
  | { type: "run-error"; error: string };
