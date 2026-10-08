import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/graph-runs/cases.json" with { type: "json" };
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import { BUILTIN_KIND_DATA } from "../src/registry/builtin-kinds";
import type { FlowGraph } from "../src/types";

registerBuiltinKinds();

/**
 * `transform` must apply a configured `expression` whether or not `mode` says so.
 *
 * fancy-flow#21. The shared fixtures author `config: { expression: "..." }` with
 * **no `mode`**, because three of the four runtimes read `expression`
 * unconditionally. This engine gated it on `mode === "expression"` and `mode`
 * defaults to `fields`, so the same graph returned the whole input object here
 * and the resolved value everywhere else. Same JSON in, different outputs —
 * which is the one guarantee the four runtimes exist to keep.
 *
 * The failure shape is why it survived: a passthrough looks like a working node.
 * Nothing errors, the run reports success, and the wrong value only shows up
 * wherever someone reads a field off it.
 *
 * `mode` still decides when it is set. An explicit `mode: "fields"` takes the
 * fields path even with an expression configured, so anyone who chose it
 * deliberately is unaffected; absent `mode` now follows the expression, matching
 * the other runtimes and this kind's own `emits`.
 */
const run = async (config: Record<string, unknown>, inputs: unknown) => {
  const graph = {
    nodes: [
      { id: "t", type: "manual_trigger", position: { x: 0, y: 0 }, data: { kind: "manual_trigger", config: {} } },
      { id: "tf", type: "transform", position: { x: 0, y: 0 }, data: { kind: "transform", config } },
    ],
    edges: [{ id: "e1", source: "t", target: "tf" }],
  } as unknown as FlowGraph;

  const result = await runFlow(graph, {}, undefined, { initialInputs: { t: inputs } });
  expect(result.ok).toBe(true);
  return result.outputs.tf;
};

describe("transform reads `expression` without requiring `mode`", () => {
  it("resolves a bare expression, as the other three runtimes do", async () => {
    // The exact config and input the shared fixtures author.
    expect(await run({ expression: "{{ $json.user.name }}" }, { user: { name: "Ada" } })).toBe("Ada");
  });

  it("still honours an explicit mode=fields over a configured expression", async () => {
    // The only behaviour that could regress: someone who set the select
    // deliberately and left an expression in the other field.
    expect(
      await run(
        { mode: "fields", fields: [{ key: "who", value: "{{ $json.user.name }}" }], expression: "{{ $json.user }}" },
        { user: { name: "Ada" } },
      ),
    ).toEqual({ who: "Ada" });
  });

  it("passes the input through when nothing is configured at all", async () => {
    // Unchanged: a half-built transform must not silently empty the payload.
    expect(await run({}, { user: { name: "Ada" } })).toEqual({ user: { name: "Ada" } });
  });

  it("agrees with the kind's own `emits`, which never consulted `mode`", () => {
    // The internal half of the same defect: this declaration already said a
    // non-empty `expression` reshapes the output, while the executor ignored it
    // unless `mode` was set. Two statements about one node, in one repo.
    const kind = BUILTIN_KIND_DATA.find((k) => k.name === "@particle-academy/transform")!;
    const emits = kind.emits as (config: { expression?: string }) => string;

    expect(emits({ expression: "{{ $json.user.name }}" })).toBe("expression:expression");
    expect(emits({})).toBe("input");
  });

  it("matches the shared fixture row rather than a shape invented here", () => {
    // If the fixtures ever start authoring `mode`, this test is measuring
    // something the table no longer asserts and should be revisited.
    const row = CASES.cases.find((c) => JSON.stringify(c).includes('"{{ $json.user.name }}"'));

    expect(row, "no graph-runs row authors a bare transform expression any more").toBeDefined();
    const tf = row!.input.schema.graph.nodes.find((n: { kind: string }) => n.kind === "transform") as
      | { config?: Record<string, unknown> }
      | undefined;
    expect(tf?.config).toBeDefined();
    expect(tf!.config!.expression).toBe("{{ $json.user.name }}");
    expect(tf!.config!.mode, "the fixture authors no mode — that is the whole point").toBeUndefined();
  });
});
