import { getNodeKind, kindIds } from "../registry/registry";
import type { FlowGraph, FlowNode } from "../types";
import type { ImportIssue } from "../schema/workflow-schema";

/**
 * Refuse a graph whose nodes cannot take part in the workflow's dataflow.
 *
 * Two shapes, both of which import cleanly and then quietly do nothing. Neither
 * FAILS — which is what makes them worth refusing at authoring time, because a
 * run that reports success is the worst way for a workflow to be wrong. Both
 * were measured against the PHP twin's engine before this was written, and both
 * behave the same way here:
 *
 * ## 1. A FLOATING node — no inbound and no outbound edge
 *
 * It is NOT skipped. A node with no incoming edge is a root, so the topo sort
 * runs it: a three-node graph with one floating `log` executed `t,lonely,o`. It
 * runs disconnected — receiving nothing from the graph and reaching nobody in
 * it — which is precisely the state an author cannot see on a canvas.
 *
 * ## 2. An edge leaving a TERMINATOR
 *
 * A terminal kind — `output`, `log` — declares an EMPTY output port list. It
 * ends a chain. Measured: `t -> output -> log` imported clean and the `log` DID
 * run, with `{{ input }}` resolving to `""`. `collectInputs` binds a payload
 * only when `"<sourceId>:<handle>"` exists, and a node publishing no ports never
 * creates that key — so the edge does not fail, it delivers nothing, and the
 * node downstream operates on a hole.
 *
 * That is the same silent-nothing the undelivered-edge diagnostic reports at run
 * time, but this one is decidable FROM THE DOCUMENT ALONE.
 *
 * ## What may float
 *
 * See {@link mayFloat}. Not only `note`: any `annotation` or `layout` kind (a
 * swimlane is never wired to anything — that is what a lane IS), and any kind
 * the registry does not know.
 */
export function checkGraphConnectivity(graph: FlowGraph): ImportIssue[] {
  const { nodes, edges } = graph;
  const issues: ImportIssue[] = [];

  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();
  for (const edge of edges) {
    hasIncoming.add(edge.target);
    hasOutgoing.add(edge.source);
  }

  // A single-node graph is not "floating" — it is a graph with one step, which
  // is a legitimate (if small) workflow and what every graph looks like on the
  // way to a bigger one. Refusing it would make the editor unusable from the
  // first node placed.
  const single = nodes.length === 1;

  for (const node of nodes) {
    if (single || mayFloat(node)) continue;

    if (!hasIncoming.has(node.id) && !hasOutgoing.has(node.id)) {
      issues.push({
        level: "error",
        nodeId: node.id,
        message:
          `Node "${node.id}" is connected to nothing — no inbound edge and no outbound edge. ` +
          `It still RUNS (a node with no inbound edge is a root), but it receives nothing from ` +
          `the graph and reaches nobody in it, so it is either unwired or left behind by a ` +
          `deletion. Only a note, an annotation or a lane may float.`,
      });
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const edge of edges) {
    const source = byId.get(edge.source);
    if (!source || !isTerminator(source)) continue;

    issues.push({
      level: "error",
      edgeId: edge.id,
      message:
        `Edge "${edge.id}" reads from "${edge.source}", which is a TERMINAL node and publishes ` +
        `no output ports at all. Nothing can ever travel this edge: it does not fail at run ` +
        `time, it delivers nothing, and "${edge.target}" runs anyway with an empty input.`,
    });
  }

  return issues;
}

/**
 * Which nodes are allowed to sit unconnected.
 *
 * Three answers, and the third is the one that took a second pass — it was
 * missed in the PHP twin's first release and shipped as 0.48.1:
 *
 * 1. **`note`**, across every id the kind answers to, so a graph saved with the
 *    canonical `@particle-academy/note` stays an annotation rather than becoming
 *    an unwireable node.
 * 2. **Any `annotation` or `layout` kind.** A host may register its own note,
 *    and `@particle-academy/lane` is a swimlane the engine walks straight past.
 *    Neither is a step and neither is ever wired.
 * 3. **A kind the registry has never heard of.** Not a loophole — the honest
 *    answer. An unknown kind already produces its own issue, and we cannot know
 *    whether it is a step, an annotation or a lane. Claiming it must be wired
 *    would assert something unverifiable, and it lands hardest on the graphs
 *    that deserve it least: a laned graph loaded by a runtime without `lane`
 *    registered would report every swimlane twice, the second time wrongly.
 *
 * The note/annotation/layout half matches the test `run-flow` uses to skip a
 * node. The unknown-kind half deliberately does NOT — see the closing comment in
 * this file for why the two must not become one helper.
 */
export function mayFloat(node: FlowNode): boolean {
  const type = node.type;
  if (!type) return false;
  if (type === "note") return true;

  const kind = getNodeKind(type);
  if (!kind) return true;

  return kindIds(kind).includes("note") || kind.category === "annotation" || kind.category === "layout";
}

/**
 * A kind that declares an EMPTY output list ends a chain.
 *
 * `[]` and `undefined` are different answers and only the first means this.
 * `undefined` is "nobody declared what this publishes", which resolves to `out`
 * and is most nodes in most graphs; `[]` is an explicit claim that there is
 * nothing to connect from. Reading them alike would refuse nearly every
 * workflow ever written.
 */
function isTerminator(node: FlowNode): boolean {
  // A node carrying its own ports overrides its kind — the engine reads these
  // first, so an author who has said what this node publishes is believed.
  // (The PHP twin's importer DROPS node-level ports, so this branch is reachable
  // there only for a hand-built graph. Noted rather than smoothed over: the two
  // importers genuinely differ here.)
  const own = (node.data as { outputs?: unknown[] } | undefined)?.outputs;
  if (Array.isArray(own)) return own.length === 0;

  const kind = node.type ? getNodeKind(node.type) : null;

  // An unregistered kind falls back to `out` in the engine, so it is not a
  // terminator. Refusing here would break a host mid-registration, and would
  // use "I do not know" as evidence.
  if (!kind) return false;

  return Array.isArray(kind.outputs) && kind.outputs.length === 0;
}

/**
 * NOT shared with `frontier`'s / `run-flow`'s annotation test, deliberately.
 *
 * The two predicates look identical and have OPPOSITE safe defaults, which is
 * exactly how a shared helper becomes a bug:
 *
 * - **Here** an unknown kind may float. Being permissive costs nothing — the
 *   unknown-kind issue already fires, and we would otherwise assert something
 *   unverifiable.
 * - **In the engine** an unknown kind must NOT be treated as an annotation.
 *   Being permissive there means SKIPPING a node the host meant to run, which
 *   is silent and unrecoverable.
 *
 * So the note/annotation/layout half is the same question and the unknown half
 * is a different one. Collapsing them into one function would read as tidier and
 * would make a host's unregistered kind stop executing.
 */
