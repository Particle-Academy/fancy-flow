/**
 * A node that declares NO output ports publishes nothing — and says so.
 *
 * Three states, and the middle one is the whole point:
 *
 *   absent  -> fall back to a lone `out`, so a hand-written document can omit
 *              ports entirely and still chain
 *   `[]`    -> this node publishes NOTHING. It terminates.
 *   a list  -> exactly those ports
 *
 * Until 0.76.0 this engine collapsed the first two, because `activatedPorts`
 * tested `declared?.length` and `[]` is falsy. That made it disagree with the
 * PHP, Python and Rust twins on the IDENTICAL document — and `exportWorkflow`
 * writes `outputs: []` for a terminal node, so the disagreement was reachable
 * by round-tripping a graph through this editor rather than by hand-authoring
 * anything unusual. Same JSON, different routing, which is the one guarantee
 * the four runtimes exist to keep.
 *
 * **Every test here asserts the WARNING as well as the routing**, and that
 * pairing is not thoroughness for its own sake. Publishing nothing cuts every
 * chain through such a node, and a silent cut is a run that ends early and
 * reports success — the worst shape of failure in this estate. The owner's
 * ruling was strict AND loud; a test that checked only the routing would pass
 * against an engine that truncates in silence, which is precisely the thing
 * that would have made this change unacceptable.
 *
 * This file exists because NOTHING here covered the case. The whole suite —
 * 1061 tests — passed identically before and after the engine change, because
 * the shared `flow/port-activation` row that pins it is skipped for node (it
 * recorded this very divergence) and this runtime does not run the
 * `flow/graph-runs` table at all.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import { registerBuiltinKinds } from "../src/registry/builtin";

beforeAll(() => {
  registerBuiltinKinds();
});

type Observed = { lit: string[]; warnings: string[]; ran: string[] };

/**
 * Run `source -> sink`, optionally without the edge, and report what the source
 * published, which warnings came out, and whether the sink actually ran.
 *
 * `hostTerm` is a kind no registry knows, so the kind fallback cannot answer
 * for it and the node's own declaration is what decides — which is the rule
 * under test rather than a builtin's port list.
 */
async function observe(outputs: unknown, withEdge = true): Promise<Observed> {
  const data: Record<string, unknown> = { kind: "hostTerm", config: {} };
  if (outputs !== undefined) data.outputs = outputs;

  const graph: any = {
    nodes: [
      { id: "r", type: "hostTerm", position: { x: 0, y: 0 }, data },
      { id: "n", type: "sink", position: { x: 0, y: 0 }, data: { kind: "sink", config: {} } },
    ],
    edges: withEdge ? [{ id: "e1", source: "r", target: "n" }] : [],
  };

  const lit: string[] = [];
  const warnings: string[] = [];
  const ran: string[] = [];

  await runFlow(
    graph,
    { hostTerm: () => ({ ok: true }), sink: () => ran.push("n") } as any,
    (e: any) => {
      if (e.type === "node-output" && e.nodeId === "r") lit.push(e.portId);
      if (e.type === "log" && e.level === "warn") warnings.push(e.message);
    },
  );

  return { lit, warnings, ran };
}

describe("a declared-empty outputs list terminates the node", () => {
  it("publishes nothing, does not reach the target, and NAMES the dead edge", async () => {
    const { lit, warnings, ran } = await observe([]);

    expect(lit).toEqual([]);
    expect(ran).toEqual([]);

    // The loudness half. Without it this is a silent truncation.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Edge e1 reads port "out" from node r');
    expect(warnings[0]).toContain("never publishes it");
  });

  it("stays SILENT when nothing is downstream", async () => {
    // The warning is keyed on the EDGE, not on publishing nothing. A terminal
    // node at the end of a chain is the ordinary case, and a diagnostic that
    // fires on correct graphs is how a real diagnostic stops being read.
    const { lit, warnings } = await observe([], false);

    expect(lit).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("still falls back to `out` when ports are UNDECLARED", async () => {
    // The state that must not change. Collapsing this one into the empty case
    // would break every hand-written document that omits ports.
    const { lit, warnings, ran } = await observe(undefined);

    expect(lit).toEqual(["out"]);
    expect(ran).toEqual(["n"]);
    expect(warnings).toEqual([]);
  });

  it("publishes exactly what a non-empty declaration names", async () => {
    const { lit } = await observe([{ id: "a" }, { id: "b" }]);

    expect(lit).toEqual(["a", "b"]);
  });
});
