import type { TerminalSession } from "./registry/capabilities";

/**
 * Public domain types for fancy-flow. Built-in nodes are layered on top of
 * @xyflow/react's `Node` so consumers can mix custom xyflow nodes alongside
 * the kit. Edges remain xyflow's standard `Edge`.
 */

import type { Edge, Node } from "@xyflow/react";
// Type-only, so this stays erased — `types.ts` must not pull a runtime module
// into every consumer that only wanted a type.
import type { RunIdentity } from "./runtime/run-identity";

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
  /**
   * Announced to a person just BEFORE this node runs — "Starting the deep
   * analysis". Authored on the node, so a graph narrates itself without the
   * host writing any per-node reporting code.
   *
   * Optional on purpose. Most nodes in a real graph are plumbing, and a run
   * that narrates all of them buries the two or three steps anyone follows.
   */
  startingMsg?: string;
  /**
   * Announced AFTER this node finishes — "Analysis complete".
   *
   * Emitted only when the node SUCCEEDS. A completion message printed after a
   * failure tells a human the opposite of what happened, in the part of the UI
   * they trust most; failures report through `node-status` and `log`.
   */
  stoppingMsg?: string;
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

/**
 * One value a workflow DECLARES that it accepts at run start.
 *
 * The declaration is the point. Before this existed, a caller passed
 * `initialInputs` keyed BY NODE ID — so they had to know the trigger happened
 * to be called `t`, and renaming that node broke every caller while the graph
 * itself stayed valid. Nothing reported it.
 *
 * And nothing said what a workflow accepted at all: no names, no types, no
 * defaults. An agent composing a call had nothing to read, and a misspelled key
 * did not fail — the value simply sat unused while the run reported success.
 */
export type WorkflowInput = {
  /** What a caller passes it as. */
  name: string;
  /**
   * Optional. Omitting it means "I am not asserting a shape", which must not
   * degrade into "nothing is allowed" — an undeclared type accepts anything.
   */
  type?: "string" | "number" | "boolean" | "object" | "array";
  /**
   * The run needs a value. Satisfied by a `default`, so `required` means
   * "this must resolve to something" rather than "the caller must type it".
   */
  required?: boolean;
  /** Used when the caller omits the key. An explicit value always wins. */
  default?: unknown;
  description?: string;
};

/** A serializable graph — what hosts persist, what agents read/write. */
export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /**
   * What this workflow accepts. Callers pass a flat object BY NAME.
   *
   * Omitted entirely when a graph takes none, so existing saved graphs are
   * unchanged byte for byte and every diff stays readable.
   */
  inputs?: WorkflowInput[];
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
    /**
     * The registry THIS run is executing against.
     *
     * Handed down so an executor that starts a NESTED run gives the child the
     * same executors as the parent. `subflow` previously ran its child against
     * `config.executors ?? {}` — an empty registry unless the graph happened to
     * carry one — so a host kind resolved at top level and vanished one level
     * down, and a host that had REPLACED a builtin got the package's version in
     * the child. Same graph, different behaviour by nesting depth, reported
     * against the PHP twin as fancy-flow-php#7.
     *
     * Inheriting from the context rather than from a parameter is what makes it
     * unforgettable: any future nesting executor gets it without opting in.
     */
    executors?: ExecutorRegistry;
    /**
     * How deep this run is nested. 0 for a top-level run; `subflow` passes
     * depth + 1 to its child, so runaway recursion can be reported by name
     * rather than as a stack overflow.
     */
    depth?: number;
    /**
     * Who is running, and which attempt of which step this is.
     *
     * `ctx.run.stepKey(ctx.node.id)` is the idempotency key for a node that
     * writes to somebody else's system — stable across retries of this step,
     * distinct for every other execution of the same node.
     *
     * `undefined` when the host supplied no identity, and that is a real
     * answer: a write with no key must decline or accept one attempt, never
     * invent a key. See `RunIdentity`.
     */
    run?: RunIdentity;
    /**
     * The terminal this node's lane owns, if it is inside a terminal lane.
     *
     * `session()` is a FUNCTION, not an open session, and that is the whole
     * lifetime rule in one shape: the terminal opens on first USE. A node that
     * sits inside a terminal lane and never calls this never spawns a process,
     * so drawing a lane around nodes that mostly do other things costs nothing.
     * Every node in the lane gets the SAME session, which is what makes `cd`
     * persist and an agent TUI still be running with its conversation intact.
     *
     * `undefined` when the node is not inside a terminal lane, and that is a
     * real answer rather than a missing one — a terminal node outside a lane
     * must say so rather than quietly opening a shell of its own, because one
     * unmanaged process per node is exactly what the lane exists to prevent.
     */
    terminal?: {
      session: () => Promise<TerminalSession>;
    };
  },
) => Promise<TOut> | TOut;

export type ExecutorRegistry = Partial<Record<FlowNodeKind | string, NodeExecutor>>;

export type RunEvent =
  | { type: "node-status"; nodeId: string; status: NodeRunStatus; text?: string }
  /**
   * A human-facing announcement a node makes around its own execution, from
   * `data.startingMsg` / `data.stoppingMsg`. Opt-in per node: most nodes in a
   * real graph are plumbing, and narrating all of them buries the few steps a
   * person cares about.
   *
   * Deliberately NOT folded into `node-status.text`, which already carries
   * "skipped", "resumed", "lane", "annotation" and raw error strings. Those are
   * diagnostics; these are addressed to a person. A consumer rendering a
   * progress feed cannot be asked to guess which is which — that is how an
   * error string ends up shown to a user as a status update.
   */
  | { type: "node-message"; nodeId: string; phase: "start" | "end"; message: string }
  | { type: "node-output"; nodeId: string; portId: string; value: unknown }
  | { type: "log"; nodeId?: string; level: "info" | "warn" | "error"; message: string; detail?: unknown }
  | { type: "run-start" }
  | { type: "run-end"; ok: boolean }
  | { type: "run-error"; error: string };
