import type {
  ExecutorRegistry,
  FlowEdge,
  FlowGraph,
  FlowNode,
  NodeExecutor,
  RunEvent,
} from "../types";
// Both modules are React-free by design — the `/engine` entry must not pull in
// React. Import them directly rather than via the `registry` barrel, which
// re-exports the RegistryNode component.
import { getNodeKind, kindIds } from "../registry/registry";
import { resolveNodePorts } from "../registry/ports";
import { RunIdentity, type RunIdentityJson } from "./run-identity";
import { resolveWorkflowProps } from "./workflow-props";

export type RunOptions = {
  /** Stop the run after this many ms. Default: no timeout. */
  timeoutMs?: number;
  /** Abort signal — host can cancel the run. */
  signal?: AbortSignal;
  /** Initial inputs supplied to entry-point nodes (no incoming edges). */
  initialInputs?: Record<string, Record<string, unknown>>;
  /**
   * Values for the inputs the graph DECLARES, passed by name.
   *
   * The flat, node-id-free way to configure a run. `initialInputs` is keyed by
   * node id, so a caller had to know the trigger was called `t` and a rename
   * broke every caller while the graph stayed valid. Props are checked against
   * `graph.inputs`, so a misspelling fails the run instead of sitting unread.
   */
  props?: Record<string, unknown>;
  /** Nesting depth — set by `subflow` when it runs a child graph. */
  depth?: number;
  /**
   * Who is running, so a writing node can derive a stable idempotency key.
   *
   * A bare string is taken as the run key. **Deliberately not defaulted:** a
   * minted-per-call key would change on every whole-run retry, which is exactly
   * the failure an idempotency key exists to prevent — so a host that has not
   * supplied one gets `ctx.run === undefined` and a connector that declines to
   * write blind, rather than a plausible-looking key that double-charges.
   */
  run?: RunIdentity | RunIdentityJson | string;
  /**
   * Outputs already checkpointed for this run, keyed by node id.
   *
   * A node present here is **republished, not re-executed** — its stored value
   * goes back onto the same ports, so downstream routing reproduces exactly
   * what it did the first time. This is what makes a per-node durable driver
   * possible without a second copy of the routing rules, and it is how the PHP
   * and Python runtimes have always resumed.
   */
  resumeOutputs?: Record<string, unknown>;
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
  const { signal, initialInputs = {}, timeoutMs, depth = 0, resumeOutputs = {} } = options;
  const run = options.run === undefined ? undefined : RunIdentity.from(options.run);
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

  // Props are checked BEFORE anything runs, and a failure aborts the run.
  //
  // Before a node executes, not after: a workflow whose third node needed a
  // value the caller misspelled would otherwise do two nodes' worth of real
  // work — sending, writing, charging — and only then discover the call was
  // malformed. Validation that happens after a side effect is not validation.
  const propsCheck = resolveWorkflowProps(graph.inputs, options.props);
  if (!propsCheck.ok) {
    onEvent({ type: "run-error", error: propsCheck.error });
    return { ok: false, outputs, error: propsCheck.error };
  }
  const props = propsCheck.props;
  const declaresProps = (graph.inputs?.length ?? 0) > 0;

  const incomingByNode = indexIncoming(graph.edges);
  const timer = timeoutMs ? setTimeout(() => errors.push(`Run timed out after ${timeoutMs}ms`), timeoutMs) : null;

  onEvent({ type: "run-start" });

  try {
    for (const node of order) {
      if (signal?.aborted) throw new Error("aborted");
      if (errors.length) break;

      // A checkpointed node is republished, never re-executed. Publishing the
      // stored value back onto its own ports is what makes the resume exact:
      // the branch it took, the ports it lit and the inputs its successors
      // collect are all reproduced by the engine's own rules rather than by a
      // driver's recollection of them.
      if (Object.prototype.hasOwnProperty.call(resumeOutputs, node.id)) {
        const stored = resumeOutputs[node.id];
        outputs[node.id] = stored;
        const activated = activatedPorts(node, stored);
        for (const portId of activated.ports) {
          portValues.set(`${node.id}:${portId}`, activated.value);
          onEvent({ type: "node-output", nodeId: node.id, portId, value: activated.value });
        }
        completed.add(node.id);
        onEvent({ type: "node-status", nodeId: node.id, status: "done", text: "resumed" });
        continue;
      }

      const incoming = incomingByNode.get(node.id) ?? [];

      // Run a node once any upstream branch reaches it. We iterate in
      // topological order, so by the time we reach this node every upstream
      // node has been processed — each incoming edge is therefore *settled*
      // (active or dead, never still-pending). Requiring ALL incoming edges to
      // be active wrongly skipped MERGE POINTS: when a Decision routes down one
      // branch, the other branch's edge stays dead forever, so an `every` check
      // skipped the shared continuation node and halted the run after the first
      // branch (#1). Run when AT LEAST ONE incoming edge is active —
      // collectInputs() only reads from the active ones. A genuine parallel
      // join still works: in topo order both of its inputs are already active.
      if (incoming.length > 0) {
        const anyActive = incoming.some((e) => portValues.has(`${e.source}:${e.sourceHandle ?? "out"}`));
        if (!anyActive) {
          onEvent({ type: "node-status", nodeId: node.id, status: "idle", text: "skipped" });
          continue;
        }
      }

      // Notes/annotations + layout (lane/pool) nodes are visual only — never
      // executed and never fed to runners. Their config (a note's text, a lane's
      // title) stays in the document for editors + MCP tools, but the engine
      // walks straight past them. Edges cross lanes freely, so grouping never
      // affects topology.
      const visualKind = getNodeKind(node.type ?? "");
      const isLayout = visualKind?.category === "layout";
      const isAnnotation = node.type === "note" || visualKind?.category === "annotation";
      if (isLayout || isAnnotation) {
        onEvent({
          type: "node-status",
          nodeId: node.id,
          status: "idle",
          text: isLayout ? "lane" : "annotation",
        });
        continue;
      }

      onEvent({ type: "node-status", nodeId: node.id, status: "running" });
      announce(onEvent, node, "start");

      const inputs = collectInputs(node, incoming, portValues, initialInputs, props, declaresProps);
      const exec = pickExecutor(executors, node);
      if (!exec) {
        // Name what was LOOKED FOR, not just what the node calls itself.
        //
        // This said `kind=${node.type}` — so a registry keyed under one of the
        // kind's other ids produced "kind=manual_trigger is missing" about a
        // kind that exists AND is registered, just under a different key. The
        // consumer who reported it reasonably read that as the kind being
        // absent and went looking for a missing package.
        const tried = executorLookupIds(node);
        const msg = `No executor registered for kind=${node.type}`
          + ` — tried ${tried.map((id) => `"${id}"`).join(", ")}`
          + ` and the wildcard "*". Key your registry by one of those.`;
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
            executors,
            depth,
            run,
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
        // Only on the success path, and deliberately so: a `stoppingMsg` of
        // "Analysis complete" emitted after a throw tells a human the opposite
        // of what happened, in the part of the UI they trust most. A failure
        // reports through node-status/log, which is what those exist for.
        announce(onEvent, node, "end");
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
  props: Record<string, unknown>,
  declaresProps: boolean,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...(initial[node.id] ?? {}) };

  // ENTRY POINTS are seeded with the props by their bare names.
  //
  // This is what lets an existing graph keep working unchanged. A trigger that
  // reads `{{ topic }}` was fed by `initialInputs[triggerId].topic`; a caller
  // moving to props passes `{ topic }` and the node sees exactly what it saw
  // before. Only entry points, because a node in the middle of a graph reading
  // a bare `topic` would be shadowing whatever its upstream edge is called.
  //
  // Never clobbers: a value already seeded by the host is the host's.
  if (incoming.length === 0) {
    for (const [name, value] of Object.entries(props)) {
      if (!(name in inputs)) inputs[name] = value;
    }
  }
  for (const e of incoming) {
    const portId = e.targetHandle ?? "in";
    const key = `${e.source}:${e.sourceHandle ?? "out"}`;
    // A branch that never fired has no entry in portValues. Assigning its
    // `undefined` would CLOBBER the value the branch that DID fire already
    // contributed on this same handle — emptying every merge point downstream
    // of a decision, silently, with the run still reporting success.
    //
    // This is the other half of the merge-point bug above: that fix stopped the
    // shared continuation node being skipped, but it still arrived with nothing
    // whenever a later inactive edge happened to be last in `incoming`.
    if (!portValues.has(key)) continue;
    inputs[portId] = portValues.get(key);

    // ALSO address it by the SOURCE NODE'S ID, when the edge named no handle.
    //
    // Authors reach for node ids -- every graph tool addresses nodes that way,
    // so `{{ n2.text }}` is the first thing written, by people and far more
    // often by assistants generating graphs. That resolved to nothing, and
    // NOTHING FAILED: an unresolvable path yields "", so the node ran, the run
    // reported success, and the damage was output that was quietly wrong. A
    // consumer shipped a file named `document.md` containing the literal text
    // of its own template, on a green run (fancy-flow-php#8).
    //
    // `targetHandle` already covers this and stays the right mechanism for
    // reading something other than the immediate predecessor -- but it is set
    // on the EDGE, which is not where an author is looking while writing a
    // node's config. The model was not wrong; the obvious spelling meant
    // nothing.
    //
    // Only for edges that declared NO handle: an edge that named one said what
    // it meant, and a second key under the source id would quietly widen a
    // deliberate contract. `??=` so nothing already seeded -- by the host's
    // initialInputs or an earlier edge -- is ever clobbered.
    if (e.targetHandle == null && !(e.source in inputs)) {
      inputs[e.source] = portValues.get(key);
    }
  }

  // EVERY node gets `$props` — but ONLY when the workflow declares inputs.
  //
  // The first half is what makes props usable at depth. Seeding entry points
  // alone would mean a node six hops downstream had the value threaded through
  // every edge in between, and every hop is somewhere it can be dropped. It
  // costs nothing to resolve because `$props` is an ORDINARY KEY in the inputs
  // object: `resolvePath` already walks dot-paths against it, so
  // `{{ $props.topic }}` works with no change to any expression resolver in any
  // of the three runtimes.
  //
  // The second half is a CORRECTION, and the golden parity fixtures caught it.
  // An earlier draft wrote `$props` unconditionally, justified as "so
  // `{{ $props.x }}` resolves to null rather than throwing" — which is not
  // true. `resolvePath` returns null for any unresolvable path, so on a graph
  // declaring nothing the key changes no behaviour at all. What it DOES do is
  // add a key to every executor's inputs, on every graph, forever — which
  // showed up instantly as a diff in every stored golden.
  //
  // `ConnectorFacet::from` states the same rule for the same reason: a payload
  // gaining a key on every entry is a wire change for no gain, and the ABSENCE
  // of a key is already the honest way to say "this one takes no props".
  //
  // Keyed on the DECLARATION rather than on whether a value arrived: a workflow
  // whose inputs are all optional and all omitted still declared a contract, so
  // `$props` is present and empty.
  if (declaresProps) inputs.$props = props;

  return inputs;
}

/**
 * Every key a node's executor may legitimately be registered under, in order.
 *
 * Shared by the lookup and by its failure message on purpose: an error that
 * lists ids the lookup did not actually try is worse than one that lists none,
 * because it sends the reader to check something that was never checked.
 */
function executorLookupIds(node: FlowNode): string[] {
  const ids: string[] = [node.id];
  if (node.type) ids.push(node.type);

  const declared = (node.data as { kind?: unknown } | undefined)?.kind;
  const kindName = typeof declared === "string" && declared !== "" ? declared : node.type;
  if (kindName && kindName !== node.type) ids.push(kindName);

  for (const name of [kindName, node.type]) {
    const kind = name ? getNodeKind(name) : null;
    if (!kind) continue;
    for (const id of kindIds(kind)) ids.push(id);
  }

  return [...new Set(ids)];
}

function pickExecutor(
  executors: ExecutorRegistry,
  node: FlowNode,
): NodeExecutor | undefined {
  if (executors[node.id]) return executors[node.id];
  if (node.type && executors[node.type]) return executors[node.type];

  // `data.kind` is where a graph carries its kind when `type` is unset, and it
  // is what EVERY other reader in this package consults -- the schema's own
  // `kindName`, FlowViewer, FlowEditor, connection.ts, subflow-cycle.ts,
  // use-flow-run.ts and `availableVariables` below all resolve
  // `data.kind ?? node.type`. This lookup was the lone exception, so a registry
  // keyed by kind simply never fired, and nothing said so: an unregistered kind
  // fails closed with no outputs, which is the right default and exactly what
  // makes the miss silent.
  //
  // `node.type` is still consulted FIRST -- it is the more specific statement,
  // and preferring `data.kind` would silently re-point graphs that already work.
  const declared = (node.data as { kind?: unknown } | undefined)?.kind;
  const kindName = typeof declared === "string" && declared !== "" ? declared : node.type;
  if (kindName && kindName !== node.type && executors[kindName]) return executors[kindName];

  // Try every id the kind answers to. Kinds are namespaced (`@fancy/switch_case`)
  // while a host may have bound its executor under the bare name it used before
  // — or vice versa. Without this, the rename would silently stop matching and
  // the node would fall through to `*` or simply not run: a breaking change
  // wearing the costume of a rename.
  //
  // BOTH names are resolved, not just whichever won above, and that was a bug.
  // This committed to `kindName` alone — so a node carrying a `data.kind` the
  // registry does not know (a category label like `"trigger"` rather than a
  // kind id, which is easy to write and says nothing false) got
  // `getNodeKind() === null`, the loop never ran, and `node.type`'s aliases
  // were never tried even though `node.type` named a real kind.
  //
  // The visible symptom was that the ONE spelling `resolveKindId()` hands you
  // — the namespaced id — was the one that failed, while the bare name worked.
  // Reported by a consumer who reasonably keyed their registry by the resolved
  // id. `data.kind` is still preferred; it simply no longer silently disables
  // the fallback.
  for (const name of [kindName, node.type]) {
    const kind = name ? getNodeKind(name) : null;
    if (!kind) continue;

    for (const id of kindIds(kind)) {
      if (executors[id]) return executors[id];
    }
  }

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
  // Resolve through the shared helper so the ports the runtime activates are
  // the same ones the canvas drew — including config-driven ports, which the
  // node's `data` does not carry. Falls back to a lone `out` when a node
  // declares nothing.
  const kind = getNodeKind((node.data as any)?.kind ?? node.type ?? "") ?? undefined;
  const declared = resolveNodePorts(node, kind).outputs?.map((p) => p.id);
  return { ports: declared?.length ? declared : ["out"], value: result };
}

/**
 * Emit a node's own status message for one phase of its execution, if it
 * declared one.
 *
 * Opt-in by absence: a node with no `startingMsg` / `stoppingMsg` says nothing,
 * because most nodes in a real graph are plumbing and narrating all of them
 * buries the two or three steps a person actually wants to follow.
 *
 * A message must be a non-empty string after trimming. An empty string is the
 * shape a cleared editor field takes, and a blank line in a progress feed is
 * indistinguishable from a real message that happens to render as nothing —
 * so it is treated as "not set" rather than as "announce nothing visible".
 */
function announce(
  onEvent: (event: RunEvent) => void,
  node: FlowNode,
  phase: "start" | "end",
): void {
  const data = node.data as { startingMsg?: unknown; stoppingMsg?: unknown } | undefined;
  const raw = phase === "start" ? data?.startingMsg : data?.stoppingMsg;
  if (typeof raw !== "string") return;

  const message = raw.trim();
  if (message === "") return;

  onEvent({ type: "node-message", nodeId: node.id, phase, message });
}
