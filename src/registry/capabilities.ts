import type { FlowGraph } from "../types";

/**
 * Host capabilities — the services core nodes need but must never depend on.
 *
 * A node that imports a provider SDK forces every consumer to install it: a
 * workflow app that never calls a model should not inherit an LLM dependency.
 * So core declares the CONTRACT and the host supplies the implementation, the
 * same arrangement `renderDocumentField` already uses for documents.
 *
 * That keeps opinionated nodes in core without their opinions: `llm_branch`
 * ships the routing semantics, port derivation and config UI, while whichever
 * client the host registers — Prism, an OpenAI SDK, a local model, a fake in a
 * test — decides how the question actually gets asked.
 *
 * Registration is deliberately explicit and typed per capability rather than a
 * stringly-keyed bag, so a missing one is a clear error at the seam instead of
 * an undefined somewhere downstream.
 */

// ── LLM ─────────────────────────────────────────────────────────────────────

export type LlmRoute = { port: string; description?: string };

export type LlmRouteRequest = {
  /** Optional framing for the decision. */
  system?: string;
  /** What the model is deciding about. */
  prompt: string;
  /** The ports it must choose between. */
  routes: LlmRoute[];
  provider?: string;
  model?: string;
  /** Host-resolved credential reference, never a raw key. */
  credential?: string;
};

export type LlmRouteChoice = {
  /** Must be one of the requested route ports. */
  port: string;
  /** Why — carried down the chosen port so a run is explainable afterwards. */
  reason?: string;
};

/**
 * The only thing core asks of an LLM: given routes, pick one.
 *
 * Deliberately not a general chat interface. A narrow contract is one a host
 * can satisfy in a few lines over any SDK, and it keeps the choice
 * machine-checkable — an implementation should constrain the model to the
 * declared ports (structured output / enum) rather than parsing prose.
 */
export type LlmClient = {
  chooseRoute: (request: LlmRouteRequest) => Promise<LlmRouteChoice> | LlmRouteChoice;
};

let llmClient: LlmClient | null = null;

/** Install the host's LLM client. Returns an unregister function. */
export function registerLlmClient(client: LlmClient): () => void {
  llmClient = client;
  return () => {
    if (llmClient === client) llmClient = null;
  };
}

export function getLlmClient(): LlmClient | null {
  return llmClient;
}

// ── Terminal ────────────────────────────────────────────────────────────────

/** What to launch. Omit `command` for the host's default shell. */
export type TerminalSessionSpec = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
};

export type TerminalExit = { exitCode: number; signal?: string };

/**
 * One live terminal, owned by the host for as long as the run needs it.
 *
 * Output arrives by SUBSCRIPTION rather than a `read()` the engine calls. A TUI
 * emits continuously and on its own schedule — repainting, streaming a reply,
 * redrawing a spinner — so a polled read either misses bytes between calls or
 * has to buffer them anyway, and every host would invent that buffer
 * differently.
 */
export type TerminalSession = {
  id: string;
  write: (data: string) => void | Promise<void>;
  /** Subscribe to output. Returns an unsubscribe. */
  onData: (listener: (chunk: string) => void) => () => void;
  /**
   * Resolves when the process exits.
   *
   * A promise rather than an `exited` flag the engine polls, so "the agent
   * quit" and "the agent has not answered yet" are distinguishable while
   * waiting. Without it a node awaiting output cannot tell a slow reply from a
   * dead process, and waits out its timeout either way.
   */
  exited: Promise<TerminalExit>;
  close: () => void | Promise<void>;
};

/**
 * The only thing core asks of a terminal: open one.
 *
 * ## Why the contract stops at the PTY
 *
 * There is deliberately no `waitForOutput(pattern)` here, though every terminal
 * node needs one. Matching is derivable from `onData`, so putting it in the
 * contract would mean every host implements it — and two implementations of one
 * agreed rule is precisely how a week of registry defects happened: both sides
 * agreed output matching should work, and would have disagreed on whether a
 * pattern spans chunk boundaries, whether ANSI escapes are stripped first, and
 * what a timeout returns.
 *
 * So core owns the matching and the host owns the process. A host satisfies
 * this in a few lines over `node-pty`; nothing about how a run interprets the
 * bytes is up to it.
 *
 * ## Why this exists at all
 *
 * A terminal cannot live in the engine. `node-pty` is a native addon, so
 * importing it would break every browser build of this package and force the
 * dependency on consumers who never run a terminal node — the same reason the
 * LLM client is a contract rather than an SDK import. The desktop app that CAN
 * spawn a PTY registers one; everyone else never notices the capability exists.
 */
export type TerminalHost = {
  open: (spec: TerminalSessionSpec) => Promise<TerminalSession> | TerminalSession;
};

let terminalHost: TerminalHost | null = null;

/** Install the host's terminal. Returns an unregister function. */
export function registerTerminalHost(host: TerminalHost): () => void {
  terminalHost = host;
  return () => {
    if (terminalHost === host) terminalHost = null;
  };
}

export function getTerminalHost(): TerminalHost | null {
  return terminalHost;
}

// ── Workflow resolution ─────────────────────────────────────────────────────

/**
 * Why a workflow reference could not be resolved.
 *
 * `missing` and `version-mismatch` are deliberately distinct. Collapsing them
 * into a bare null makes "no such workflow" indistinguishable from "that
 * workflow exists, but it is not the one you pinned" — and the second wants an
 * error naming both versions, because it is the interesting failure.
 */
export type WorkflowResolutionFailure = {
  reason: "missing" | "version-mismatch";
  /** The version the host actually holds, when it holds one. */
  available?: number;
  message?: string;
};

export type WorkflowResolution = FlowGraph | WorkflowResolutionFailure | null;

/**
 * Resolve a workflow reference to a runnable graph.
 *
 * `subflow` names another workflow rather than embedding it, so the host owns
 * where workflows live — a database, a file, an API.
 *
 * ## Why `version` is here
 *
 * A workflow another workflow depends on is an INTERFACE, and interfaces need
 * pins. Without a version, a parent goes on calling `invoice-triage`, someone
 * edits that child, and the parent now runs different logic having reported
 * success the whole time — correct-looking, no error, wrong behaviour. The same
 * failure family as the 0.9.0 routing divergence.
 *
 * The parameter lives on the resolver rather than being encoded into the ref
 * string (`invoice-triage@3`) because a stringly-typed protocol is one every
 * host invents differently — the "three vocabularies for one node" problem.
 *
 * Raised by the MOIC Suite consumer, whose `workflow_ref` pins versions and
 * fails loudly on mismatch. Their point: a host COULD NOT implement pinning
 * before this, because the node had no way to ask and the resolver no way to
 * receive.
 *
 * Returning `null` still means "no such workflow". Return a
 * {@link WorkflowResolutionFailure} to distinguish a version mismatch.
 */
export type WorkflowResolver = (
  ref: string,
  version?: number,
) => Promise<WorkflowResolution> | WorkflowResolution;

/** Narrow a resolver's return value to an explicit failure. */
export function isResolutionFailure(value: WorkflowResolution): value is WorkflowResolutionFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "reason" in value &&
    (value as WorkflowResolutionFailure).reason !== undefined
  );
}

let workflowResolver: WorkflowResolver | null = null;

/** Install the host's workflow resolver. Returns an unregister function. */
export function registerWorkflowResolver(resolver: WorkflowResolver): () => void {
  workflowResolver = resolver;
  return () => {
    if (workflowResolver === resolver) workflowResolver = null;
  };
}

export function getWorkflowResolver(): WorkflowResolver | null {
  return workflowResolver;
}

// ── Introspection ───────────────────────────────────────────────────────────

export type CapabilityId = "llm" | "workflow_resolver" | "document";

/**
 * Which capabilities are currently satisfied.
 *
 * Exists so a host (or the CLI, or an agent over MCP) can answer "what does
 * this graph need that I haven't wired?" BEFORE a run fails halfway through.
 */
export function capabilityStatus(): Record<CapabilityId, boolean> {
  // Imported lazily to avoid dragging the React-dependent rich-input module
  // into the headless engine.
  let documentReady = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, no-undef
    documentReady = Boolean((globalThis as any).__fancyFlowDocumentAdapter);
  } catch {
    documentReady = false;
  }
  return {
    llm: llmClient !== null,
    workflow_resolver: workflowResolver !== null,
    document: documentReady,
  };
}
