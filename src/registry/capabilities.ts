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
