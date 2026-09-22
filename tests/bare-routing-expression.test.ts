import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/graph-runs/cases.json" with { type: "json" };
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph } from "../src/types";

registerBuiltinKinds();

// Scope to #24. The legacy whole-graph goldens also cover unrelated transform
// contracts; these eight rows add exact refusals and assert no downstream effects.
const rows = CASES.cases.filter((row) => row.id.includes("-bare-") || row.id.includes("-unclosed-"));
describe("shared bare routing expressions", () => {
  it("loads all eight refusal rows", () => expect(rows).toHaveLength(8));
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
        // Preserve the TS builder fallback: raw JSON scalars do not override
        // conditions[]. With no builder rows they take false, even true / 1.
        if (kind === "branch" && (typeof value !== "string" || value === "" || value === "  " || value === "\n\t" || value === "{{ in.data.fits }}")) {
          expect(result.outputs.r).toMatchObject({ __port: "false" });
        }
      });
    }
  }
});
