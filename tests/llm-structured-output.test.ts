import { describe, expect, it } from "vitest";
import { BUILTIN_KINDS, registerBuiltinKinds } from "../src/registry/builtin";
import { availableVariables } from "../src/expressions/variables";
import type { FlowGraph } from "../src/types";

/**
 * Schema-typed output for `llm_call` (fancy-flow#6).
 *
 * The runtime half lives in `fancy-flow-php` — this side is the declaration
 * that makes the feature reachable: a config field to set the schema, and an
 * `outputShape` entry so the variable picker offers `{{ $json.data }}`.
 *
 * That second half is the one worth a test. A node can gain a capability the
 * runtime honours perfectly and stay invisible to every author, because the
 * only way to discover `data` is for the picker to offer it. Shipping the
 * parser without this would be the suite's most common defect shape: wired to
 * nothing.
 */
const llmCall = BUILTIN_KINDS.find((k) => k.name === "@particle-academy/llm_call");

describe("llm_call declares structured output", () => {
  it("exists, so the rest of this file is not asserting over undefined", () => {
    expect(llmCall).toBeDefined();
  });

  it("offers a response_schema field the author can fill in", () => {
    const field = llmCall?.configSchema?.find((f) => f.key === "response_schema");

    expect(field).toBeDefined();
    // `json` rather than `textarea`: the editor gives a JSON editor with
    // validation, and the runtime accepts the parsed value or the raw string.
    expect(field?.type).toBe("json");
    expect(field?.description ?? "").toMatch(/data/i);
  });

  it("declares `data` ONLY when a schema was asked for", () => {
    // The conditionality is the point. `data` exists on the wire only when this
    // node was given a schema, so offering it otherwise would put a path in the
    // picker that resolves to null at runtime on every other llm_call.
    const shapeFor = (config: Record<string, unknown>) => {
      const shape = llmCall?.outputShape;
      const resolved = typeof shape === "function" ? shape(config as never) : (shape ?? []);
      return resolved.map((o) => o.path);
    };

    expect(shapeFor({})).not.toContain("data");
    expect(shapeFor({ response_schema: { type: "object" } })).toContain("data");
    // A schema field the author opened and left empty is not a schema.
    expect(shapeFor({ response_schema: "" })).not.toContain("data");

    // Additive either way — nothing that already resolved stops resolving.
    for (const config of [{}, { response_schema: { type: "object" } }]) {
      expect(shapeFor(config)).toContain("text");
      expect(shapeFor(config)).toContain("usage");
    }
  });

});

describe("the picker reaches it", () => {
  // The picker resolves a node's kind through the REGISTRY, so the builtins
  // have to be registered for this to be testing the real lookup rather than
  // an empty one.
  registerBuiltinKinds();

  // React Flow's node shape — the kind is read from `data.kind`, not a
  // top-level field.
  const node = (id: string, kind: string) =>
    ({ id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id, config: {} } }) as never;

  // An llm_call that WAS given a schema — the only case where `data` is on the
  // wire, and therefore the only case the picker should offer it.
  const nodeWithSchema = (id: string) =>
    ({
      id,
      type: "@particle-academy/llm_call",
      position: { x: 0, y: 0 },
      data: {
        kind: "@particle-academy/llm_call",
        label: id,
        config: { response_schema: { type: "object" } },
      },
    }) as never;

  const graph = (): FlowGraph =>
    ({
      nodes: [nodeWithSchema("a"), node("b", "@particle-academy/output")],
      edges: [{ id: "e", source: "a", target: "b" }],
    }) as unknown as FlowGraph;

  it("offers {{ $json.data }} downstream of an llm_call", () => {
    const paths = availableVariables(graph(), "b").map((v) => v.expression);

    expect(paths).toContain("{{ $json.data }}");
    // Still offers the old ones, so this did not displace anything.
    expect(paths).toContain("{{ $json.text }}");
  });
});
