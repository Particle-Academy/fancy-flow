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
  /**
   * Which ENTRY POINTS are live — the ids of nodes with NO incoming edges this
   * run should start from. Omit it and every entry point runs, exactly as
   * before the option existed.
   *
   * A graph may hold more than one trigger — a `manual_trigger` for
   * hand-testing beside the event trigger that runs it for real — and a trigger
   * has no inbound edges, which IS the readiness rule. So without this, every
   * trigger's branch runs on every run, whichever one fired. The triggers
   * themselves are harmless; everything DOWNSTREAM of the ones that did not
   * fire is not. A `user_input` stranded on the manual branch parks an
   * event-driven run to ask a person for data the event already supplied,
   * which from outside looks like the event trigger being ignored.
   *
   * Naming the live entry points makes the others INACTIVE, and the existing
   * "at least one active inbound edge" rule then skips everything reachable
   * only from them. No new routing logic.
   *
   * Three edges, each pinned by `flow/entry-points` in
   * `@particle-academy/fancy-conformance`:
   *  - `undefined` is NOT `[]`. Unset runs every entry point; an empty array
   *    says none is live and runs nothing.
   *  - A node reachable from SEVERAL entry points still runs when any one of
   *    them fires — one active inbound edge is enough, as always.
   *  - Naming a node that HAS inbound edges names no entry point, so every real
   *    entry is inactive and nothing runs. That falls out of the rule rather
   *    than being special-cased; validate your ids if you want a typo to be
   *    loud, because the runtime cannot tell one from a deliberate empty
   *    selection.
   */
  entryNodes?: string[];
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
  const { signal, initialInputs = {}, timeoutMs, depth = 0, resumeOutputs = {}, entryNodes } = options;
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

      // An ENTRY POINT this run did not start from is inactive.
      //
      // A node with no inbound edges is unconditionally ready -- that IS the
      // readiness rule -- so a graph with two triggers ran both branches on
      // every run, whichever trigger actually fired. Marking the unnamed ones
      // inactive here lets the "at least one active inbound edge" test below
      // skip everything reachable only from them, with no new routing logic.
      //
      // Gates only nodes with NO incoming edges: a node further down the graph
      // is not an entry point, and its readiness is still decided by its edges.
      if (incoming.length === 0 && entryNodes !== undefined && !entryNodes.includes(node.id)) {
        onEvent({ type: "node-status", nodeId: node.id, status: "idle", text: "skipped" });
        continue;
      }

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
        // The wildcard is part of `executorLookupIds` now, so it is already in
        // the list — appending "and the wildcard" as well made the message name
        // it twice, and the test that reads the ids back out of the message
        // parsed the prose between the two quoted stars as an id.
        const tried = executorLookupIds(node);
        const msg = `No executor registered for kind=${node.type}`
          + ` — tried ${tried.map((id) => `"${id}"`).join(", ")}`
          + `. Key your registry by one of those.`;
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
 * Every key a node's executor may legitimately be registered under, in
 * precedence order. **This is the resolution rule** — `pickExecutor` walks this
 * list and takes the first hit, and the failure message lists the same ids.
 *
 * That sharing is the point, and it used to be a claim rather than a fact: this
 * docblock already said "shared by the lookup and by its failure message" while
 * `pickExecutor` re-implemented the walk beside it. The two agreed until the
 * precedence changed, and then the message listed an id the lookup no longer
 * tried — sending a reader to check something that never happened, which the
 * comment correctly named as worse than listing nothing. **Prose next to a check
 * is not the check.** One list now, walked by both, so they cannot drift.
 *
 * The order, and why:
 *
 * 1. `node.id` — the per-node override. First so a graph can pin ONE node to a
 *    stub without unbinding that kind for every other node using it.
 * 2. `node.type`, then every id its kind answers to — **if `node.type` names a
 *    registered kind, it is authoritative and `data.kind` is not consulted at
 *    all.** A node that says it is an `llm_call` must never quietly run another
 *    kind's code; it fails closed instead.
 * 3. Otherwise `data.kind` and its kind's ids. A `node.type` naming no
 *    registered kind is not a claim about behaviour — usually it is an xyflow
 *    RENDERER type (`"fancyNode"`), which is ordinary practice, and then
 *    `data.kind` is the only real answer. This branch also covers `type` absent.
 * 4. `"*"` — the wildcard, last, and a sentinel rather than a kind: it is never
 *    expanded through the alias machinery, or every unmatched node would bind to
 *    whatever a kind literally named `*` aliased to.
 *
 * Pinned as `flow/executor-resolution` in `@particle-academy/fancy-conformance`.
 */
function executorLookupIds(node: FlowNode): string[] {
  const ids: string[] = [node.id];
  if (node.type) ids.push(node.type);

  const typeKind = node.type ? getNodeKind(node.type) : null;

  if (typeKind) {
    for (const id of kindIds(typeKind)) ids.push(id);
  } else {
    const declared = (node.data as { kind?: unknown } | undefined)?.kind;
    const kindName = typeof declared === "string" && declared !== "" ? declared : null;

    if (kindName) {
      ids.push(kindName);
      const dataKind = getNodeKind(kindName);
      if (dataKind) {
        for (const id of kindIds(dataKind)) ids.push(id);
      }
    }
  }

  ids.push("*");

  return [...new Set(ids)];
}

function pickExecutor(
  executors: ExecutorRegistry,
  node: FlowNode,
): NodeExecutor | undefined {
  // The whole rule lives in `executorLookupIds` -- see its docblock. Walking
  // that one list is what keeps the resolution and the failure message from
  // ever disagreeing about which keys were tried.
  for (const id of executorLookupIds(node)) {
    if (executors[id]) return executors[id];
  }

  return undefined;
}

function activatedPorts(node: FlowNode, result: unknown): { ports: string[]; value: unknown } {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.__port === "string") {
      return { ports: [r.__port], value: r.value };
    }
    if (typeof r.branch === "string") {
      // `Object.hasOwn`, NOT `??`. The two are different questions:
      //   no `value` key at all -> the whole result IS the payload (the case
      //                            this fallback exists for)
      //   `value` present, null -> the payload is null; pass null on
      // `r.value ?? r` cannot tell them apart, so a branch whose payload was
      // null leaked the WRAPPER downstream -- every following node received
      // `{ branch, value }`, two fields no kind declares, while the fields it
      // does declare were absent. The reachable path is an upstream `transform`
      // whose dot-path did not resolve, which is exactly the silent-null case.
      // `Port.only`'s `?? null` never had it. All four runtimes shared this,
      // identically -- so no parity table could catch it; they agreed on being
      // wrong.
      return { ports: [r.branch], value: Object.hasOwn(r, "value") ? r.value : r };
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
