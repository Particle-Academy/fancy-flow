import { describe, expect, it } from "vitest";
import { findSubflowCycle } from "../src/analysis/subflow-cycle";
import type { FlowGraph } from "../src/types";
import type { WorkflowResolver } from "../src/registry/capabilities";

/**
 * Static subflow-cycle detection — the TS twin of `FancyFlow\Analysis\SubflowCycle`
 * (fancy-flow-php#5).
 *
 * A `subflow` loop was only caught at RUNTIME, by the depth cap in
 * `subflowExecutor`. By then the work has already been done N times over —
 * every node above the subflow ran on each pass, side effects included — and
 * the author sees an opaque failure deep in a run while the graph that caused
 * it is still saved and still runnable.
 *
 * The editor is where an author would most naturally be stopped, which is why
 * this exists on the TS side too rather than only in the PHP runtime.
 */

function node(id: string, kind: string, config: Record<string, unknown> = {}) {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { kind, config },
  } as unknown as FlowGraph["nodes"][number];
}

function callsSubflow(ref: string, version?: number, kind = "subflow"): FlowGraph {
  const config: Record<string, unknown> = { workflow: ref };
  if (version !== undefined) config.version = version;
  return { nodes: [node("sf", kind, config)], edges: [] };
}

/** A resolver over a fixed ref → graph map. */
function mapResolver(graphs: Record<string, FlowGraph>): WorkflowResolver {
  return (ref: string, version?: number) => {
    const key = version === undefined ? ref : `${ref}@${version}`;
    return graphs[key] ?? graphs[ref] ?? null;
  };
}

const leaf: FlowGraph = { nodes: [node("out", "output")], edges: [] };

describe("findSubflowCycle", () => {
  it("returns an empty chain for a graph with no subflow", async () => {
    expect(await findSubflowCycle(leaf, mapResolver({}))).toEqual([]);
  });

  it("returns an empty chain for a subflow that does not loop", async () => {
    const resolver = mapResolver({ Digest: leaf });
    expect(await findSubflowCycle(callsSubflow("Digest"), resolver, "Daily Planner")).toEqual([]);
  });

  it("names the chain for a workflow that references itself", async () => {
    const resolver = mapResolver({ "Daily Planner": callsSubflow("Daily Planner") });
    expect(
      await findSubflowCycle(callsSubflow("Daily Planner"), resolver, "Daily Planner"),
    ).toEqual(["Daily Planner", "Daily Planner"]);
  });

  it("names the whole chain for an indirect loop", async () => {
    const resolver = mapResolver({
      Digest: callsSubflow("Daily Planner"),
      "Daily Planner": callsSubflow("Digest"),
    });
    expect(await findSubflowCycle(callsSubflow("Digest"), resolver, "Daily Planner")).toEqual([
      "Daily Planner",
      "Digest",
      "Daily Planner",
    ]);
  });

  it("awaits an async resolver", async () => {
    // The TS resolver may return a promise; the PHP one cannot. Parity is in
    // behaviour, not signature.
    const resolver: WorkflowResolver = async (ref) =>
      ref === "Loop" ? callsSubflow("Loop") : null;

    expect(await findSubflowCycle(callsSubflow("Loop"), resolver, "Loop")).toEqual([
      "Loop",
      "Loop",
    ]);
  });

  it("treats an unresolvable ref as safe", async () => {
    expect(await findSubflowCycle(callsSubflow("nope"), mapResolver({}))).toEqual([]);
  });

  it("treats a resolution failure as safe", async () => {
    const resolver: WorkflowResolver = () => ({ reason: "version-mismatch", available: 3 });
    expect(await findSubflowCycle(callsSubflow("Pinned", 1), resolver)).toEqual([]);
  });

  it("does not report a diamond as a cycle", async () => {
    const resolver = mapResolver({ B: callsSubflow("D"), C: callsSubflow("D"), D: leaf });
    const root: FlowGraph = {
      nodes: [node("b", "subflow", { workflow: "B" }), node("c", "subflow", { workflow: "C" })],
      edges: [],
    };
    expect(await findSubflowCycle(root, resolver, "A")).toEqual([]);
  });

  it("distinguishes version pins", async () => {
    const resolver = mapResolver({ "A@2": leaf });
    expect(await findSubflowCycle(callsSubflow("A", 2), resolver, "A")).toEqual([]);
  });

  it("follows the namespaced kind id as well as the bare one", async () => {
    const resolver = mapResolver({
      Loop: callsSubflow("Loop", undefined, "@particle-academy/subflow"),
    });
    expect(
      await findSubflowCycle(
        callsSubflow("Loop", undefined, "@particle-academy/subflow"),
        resolver,
        "Loop",
      ),
    ).toEqual(["Loop", "Loop"]);
  });

  it("descends into an inline subgraph", async () => {
    const rootGraph: FlowGraph = {
      nodes: [
        node("sg", "subgraph", {
          graph: {
            nodes: [{ id: "inner", type: "subflow", data: { kind: "subflow", config: { workflow: "Root" } } }],
            edges: [],
          },
        }),
      ],
      edges: [],
    };
    const resolver = mapResolver({ Root: rootGraph });

    expect(await findSubflowCycle(rootGraph, resolver, "Root")).toEqual(["Root", "Root"]);
  });
});
