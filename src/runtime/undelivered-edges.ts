/**
 * AN EDGE THAT DELIVERS NOTHING MUST SAY SO — the one implementation of that
 * check, shared by every path that can reach it.
 *
 * `runFlow` asks it of each node it reaches. The durable `Coordinator` asks it
 * of each node its frontier SKIPS, because a skipped node never gets a job and
 * so never replays to ask it for itself. Two copies of this check would agree
 * for a while and then disagree on one handle — which is exactly the kind of
 * divergence the warning exists to report — so there is one, and it EMITS
 * nothing. It returns the events and each caller decides where they go.
 *
 * Kept React-free on purpose: `run-flow.ts` imports it, and the `/engine` entry
 * must not reach React.
 */
import type { FlowEdge, FlowNode, RunEvent } from "../types";
// React-free modules, imported directly rather than via the `registry` barrel,
// which re-exports the RegistryNode component.
import { defaultConfigFor, getNodeKind } from "../registry/registry";
import { nodeConfig, resolvePortSpec } from "../registry/ports";
import { outputFieldsFor } from "../expressions/variables";

/**
 * The `log` / `warn` events for every inbound edge of `target` that delivers
 * nothing and never could.
 *
 * Asked BEFORE the activity gate, because the two outcomes are both silent and
 * only one reaches `collectInputs`. If the bad edge is the node's only inbound
 * one the node is SKIPPED; if it has another live edge it RUNS with that port
 * simply missing -- and then a downstream template that is entirely correct
 * renders empty, because the payload never arrived to have a field in it.
 *
 * Keyed on the source having COMPLETED and on the handle being a port the source
 * could NEVER publish. A branch that was not taken is ordinary and must never
 * warn; a source that finished and cannot publish this port is a
 * misconfiguration that delivers nothing on any run. A warning that fires on
 * ordinary branching is noise, and noise is how a real warning stops being read.
 * PHP has always said this; this runtime ran the same graph and said nothing
 * (fancy-flow#17). Pinned by `flow/run-diagnostics`.
 *
 * - `incoming` — the target's inbound edges, in graph order.
 * - `portValues` — keyed `"<nodeId>:<portId>"`, one key per port a node
 *   published, in publication order. Only the KEYS are read: which ports
 *   published, never what they carried.
 * - `completed` — the ids of nodes that ran to an output. A source that did not
 *   complete is never judged (row 0014).
 * - `nodesById` — every node of the graph, to resolve a source's ports and
 *   output fields.
 */
export function undeliveredEdgeWarnings(
  target: FlowNode,
  incoming: readonly FlowEdge[],
  portValues: ReadonlyMap<string, unknown>,
  completed: ReadonlySet<string>,
  nodesById: ReadonlyMap<string, FlowNode>,
): RunEvent[] {
  const events: RunEvent[] = [];

  for (const e of incoming) {
    const handle = e.sourceHandle ?? "out";
    if (portValues.has(`${e.source}:${handle}`) || !completed.has(e.source)) continue;
    if (possiblePortIds(nodesById.get(e.source)).includes(handle)) continue;

    events.push({
      type: "log",
      nodeId: target.id,
      level: "warn",
      message: undeliveredEdgeMessage(e, target, portValues, nodesById),
      detail: { edge: e.id, source: e.source, sourceHandle: handle },
    });
  }

  return events;
}

/**
 * Every port this node COULD publish — not the ones it did.
 *
 * The distinction that keeps the undelivered-edge warning honest. A `branch`
 * that took `true` publishes no `false`, and the edge leaving `false` binds
 * nothing: that is ORDINARY BRANCHING. A handle that is not a port of the node
 * at all can never bind on any run. "Did it publish?" cannot tell those apart —
 * both are absent — so this asks what is POSSIBLE.
 *
 * The rule is the PHP twin's `PortResolution::possible`, precedence and all,
 * because a warning one runtime raises and another does not is a parity failure:
 *
 *   1. the node's own declared `outputs`;
 *   2. the kind's CONFIG-DERIVED ports, when the config declares any;
 *   3. the kind's declared ports;
 *   4. `out`.
 *
 * It differs from `resolveNodePorts` in exactly one place, on purpose. A kind
 * whose ports come from config — `switch_case`, `llm_router` — and whose config
 * declares none yet answers with its DEFAULT-config shape (`case_a`, `case_b`,
 * `default`), which is what PHP's static declaration for that kind is.
 * `resolveNodePorts` answers with what that empty config yields (`default`
 * alone), which is right for the canvas and for `activatedPorts`, so it is left
 * alone: this only decides whether to warn, never what routes.
 */
function possiblePortIds(node: FlowNode | undefined): string[] {
  if (!node) return ["out"];

  const own = (node.data as { outputs?: unknown } | undefined)?.outputs;
  if (Array.isArray(own)) return own.map((p: { id: string }) => p.id);

  // An unregistered kind is not ambiguous: `activatedPorts` falls back to
  // exactly `out` for a kind it cannot resolve, so that is all it publishes.
  const kind = getNodeKind((node.data as any)?.kind ?? node.type ?? "");
  if (!kind) return ["out"];

  const config = nodeConfig(node);
  const representative = typeof kind.outputs === "function" && !configDeclaresPorts(kind.name, config);
  const resolved = resolvePortSpec(kind.outputs, representative ? defaultConfigFor(kind) : config);

  // THREE states, not two. `undefined` is "this kind declares nothing", which
  // falls back to `out` exactly as `activatedPorts` does. An empty ARRAY is a
  // kind declaring it has no output ports, and it is returned as such.
  //
  // This line read `ids.length > 0 ? ids : ["out"]` until 0.76.0, collapsing
  // both into `out` — the same empty-to-`out` collapse `activatedPorts` made,
  // in the other of the two gates that shape a port set. Fixing only the
  // activation side would have been half a fix, and the dangerous half: the
  // node would publish nothing while this lookup still reported `out` as
  // deliverable, so the undelivered-edge warning would stay SILENT for exactly
  // the edge that had just stopped delivering.
  if (resolved === undefined) return ["out"];

  return resolved.map((p) => p.id);
}

/**
 * Whether a config-driven kind's config declares any ports of its own — PHP's
 * `configDerived` returning non-empty. Matched on the BARE kind name, as there:
 * graphs carry both `switch_case` and `@particle-academy/switch_case`.
 */
function configDeclaresPorts(kindName: string, config: Record<string, unknown>): boolean {
  const bare = kindName.startsWith("@") ? kindName.slice(kindName.lastIndexOf("/") + 1) : kindName;

  if (bare === "switch_case") {
    // `cases` maps VALUE => PORT, so the ports are its values.
    const cases = config.cases;
    return !!cases && typeof cases === "object"
      && Object.values(cases).some((port) => typeof port === "string" && port !== "");
  }

  if (bare === "llm_router") {
    const routes = config.routes;
    return Array.isArray(routes)
      && routes.some((route) => (route as { port?: unknown } | null)?.port != null && (route as { port: unknown }).port !== "");
  }

  return true;
}

/**
 * The message for an edge whose source port publishes nothing.
 *
 * The PHP twin's wording, byte for byte, and each part earns its place:
 *
 *   1. THE EDGE ID FIRST — the thing the author, looking at a graph, can act on.
 *   2. THE CONSEQUENCE, IN RUNTIME TERMS. Without "nothing would reach X" this
 *      reads as a schema nit, and a handle string feels cosmetic.
 *   3. THE AVAILABLE PORTS — what the source ACTUALLY published on this run, in
 *      publication order, so a config-driven kind reports its real ports.
 *   4. THE REMEDY FOR THE COMMON CASE. Nearly every occurrence is an agent
 *      ADDING a handle that should not be there, so "leave sourceHandle off" —
 *      offered only when there is a handle to leave off.
 *
 * Plus the part only the engine can supply: when the handle names a FIELD of
 * the source kind's output shape, say so. That is the actual confusion — a field
 * name where a port belongs — and naming it turns a correction into an
 * explanation.
 */
function undeliveredEdgeMessage(
  edge: FlowEdge,
  target: FlowNode,
  portValues: ReadonlyMap<string, unknown>,
  nodesById: ReadonlyMap<string, FlowNode>,
): string {
  const handle = edge.sourceHandle ?? "out";

  const prefix = `${edge.source}:`;
  const available: string[] = [];
  for (const key of portValues.keys()) {
    if (key.startsWith(prefix)) available.push(key.slice(prefix.length));
  }

  let message =
    `Edge ${edge.id} reads port "${handle}" from node ${edge.source}, which never publishes it — ` +
    `nothing would reach ${target.id} at run time.`;

  if (available.length > 0) message += ` Available: ${available.join(", ")}.`;

  // The near-miss: a FIELD of that name, where a PORT was expected.
  const source = nodesById.get(edge.source);
  if (source && outputFieldsFor(source).some((field) => field?.path === handle)) {
    message +=
      ` Note: "${handle}" is a FIELD this node emits, not a port — read it downstream as ` +
      `{{ in.${handle} }} rather than naming it as a source handle.`;
  }

  if (edge.sourceHandle != null) message += " Leave sourceHandle off to read the node's output.";

  return message;
}
