import { describe, expect, it } from "vitest";
import { suiteVersion } from "@particle-academy/fancy-conformance";
import CASES from "@particle-academy/fancy-conformance/suites/flow/graph-runs/cases.json" with { type: "json" };
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph } from "../src/types";

registerBuiltinKinds();

// Scope to #24. The legacy whole-graph goldens also cover unrelated transform
// contracts; these eight rows add exact refusals and assert no downstream effects.
const rows = CASES.cases.filter((row) => row.id.includes("-bare-") || row.id.includes("-unclosed-"));
describe("shared bare routing expressions", () => {
  it("loads all eight refusal rows from the pinned fixture version", () => {
    console.log(`flow/graph-runs routing refusals [node] -- fancy-conformance ${suiteVersion()}`);
    expect(suiteVersion()).toBe("0.32.0");
    expect(rows).toHaveLength(8);
  });
  for (const row of rows) {
    it(row.id, async () => {
      const graph = row.input.schema.graph;
      const nodes = graph.nodes.map((node) => ({
        id: node.id, type: node.kind, position: node.position,
        data: { kind: node.kind, config: "config" in node ? node.config : {} },
      }));
      const result = await runFlow({ nodes, edges: graph.edges } as FlowGraph, {}, undefined,
        { initialInputs: row.input.initialInputs });
      expect({ ok: result.ok, error: result.error }).toEqual(row.expected);
      expect(Object.keys(result.outputs)).toEqual(["t"]);
    });
  }
});

describe("routing values outside the bare-string refusal", () => {
  for (const kind of ["branch", "switch_case"]) {
    for (const value of ["", "  ", "\n\t", true, false, 1, 0, null, "{{ in.data.fits }}", "prefix {{ in.kind }}", "{{ in.kind }}-{{ in.kind }}"]) {
      it(`${kind} still accepts ${JSON.stringify(value)}`, async () => {
        const key = kind === "branch" ? "condition" : "value";
        const graph = {
          nodes: [{ id: "r", type: kind, position: { x: 0, y: 0 }, data: { config: { [key]: value } } }],
          edges: [],
        } as unknown as FlowGraph;
        const result = await runFlow(graph, {}, undefined, { initialInputs: { r: { in: { data: { fits: false }, kind: "b" } } } });
        expect(result.ok).toBe(true);
        // The port for EVERY value, not a subset.
        //
        // This used to assert `false` for every non-string, under "raw JSON
        // scalars do not override conditions[] ... even true / 1". That was the
        // TypeScript side of a parity hole: PHP, Python and Rust pass a
        // non-string straight to truthy(), so `condition: true` routed `true`
        // there and `false` here. TS moved, because its empty-rows rule is about
        // an UNCONFIGURED branch and a raw `true` is configured.
        //
        // Listed exhaustively, so the next change to this rule has to state what
        // it means for each value rather than fall outside an `if`.
        if (kind === "branch") {
          const ports: Record<string, string> = {
            [JSON.stringify("")]: "false",
            [JSON.stringify("  ")]: "false",
            [JSON.stringify("\u000A\u0009")]: "false",
            [JSON.stringify(null)]: "false",
            [JSON.stringify(true)]: "true",
            [JSON.stringify(false)]: "false",
            [JSON.stringify(1)]: "true",
            [JSON.stringify(0)]: "false",
            [JSON.stringify("{{ in.data.fits }}")]: "false",
            [JSON.stringify("prefix {{ in.kind }}")]: "true",
            [JSON.stringify("{{ in.kind }}-{{ in.kind }}")]: "true",
          };
          expect(result.outputs.r).toMatchObject({ __port: ports[JSON.stringify(value)] });
        }
      });
    }
  }
});
