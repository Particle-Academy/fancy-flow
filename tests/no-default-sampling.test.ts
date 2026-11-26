/**
 * No sampling parameter unless the author sets one.
 *
 * `llm_call` declared `temperature` with `default: 0.7`. `defaultConfigFor()`
 * copies every declared default into a fresh node, so the editor, a headless
 * authoring server and `importWorkflow()` (for a node saved without a config)
 * all wrote `temperature: 0.7` into nodes nobody had configured, and the host's
 * adapter then forwarded it to the provider. Current Anthropic models reject a
 * request that sets `temperature`, so such a node failed on its first call.
 *
 * The default is now ABSENT. An explicit value still passes through untouched:
 * whether a provider accepts it is the adapter's call, not the engine's.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { defaultConfigFor, getNodeKind, listNodeKinds, resetNodeKindsForTests } from "../src/registry/registry";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { exportWorkflow, importWorkflow, WORKFLOW_SCHEMA_VERSION } from "../src/schema/workflow-schema";

const SAMPLING = ["temperature", "top_p", "top_k", "topP"] as const;

beforeEach(() => {
  resetNodeKindsForTests();
  registerBuiltinKinds();
});

function llmCallDoc(config?: Record<string, unknown>) {
  return {
    version: WORKFLOW_SCHEMA_VERSION,
    graph: {
      nodes: [
        { id: "t", kind: "manual_trigger", position: { x: 0, y: 0 } },
        { id: "llm", kind: "llm_call", position: { x: 1, y: 0 }, ...(config ? { config } : {}) },
      ],
      edges: [{ id: "e1", source: "t", target: "llm" }],
    },
  };
}

describe("sampling parameters have no default", () => {
  test("a fresh llm_call node carries no temperature", () => {
    const config = defaultConfigFor(getNodeKind("llm_call")!);
    expect(config).not.toHaveProperty("temperature");
    // The other defaults are untouched: this is not "no defaults at all".
    expect(config.max_tokens).toBe(1024);
  });

  test("no builtin kind declares a default for any sampling parameter", () => {
    const kinds = listNodeKinds();
    // Vacuity guard: an empty registry would pass the loop below.
    expect(kinds.length).toBeGreaterThan(10);
    for (const kind of kinds) {
      for (const field of kind.configSchema ?? []) {
        if (!(SAMPLING as readonly string[]).includes(field.key)) continue;
        expect(field, `${kind.name}.${field.key}`).not.toHaveProperty("default");
      }
      const fresh = defaultConfigFor(kind);
      for (const key of SAMPLING) expect(fresh, `${kind.name} fresh config`).not.toHaveProperty(key);
    }
  });

  test("the temperature field is still declared, so an author can set it", () => {
    const field = getNodeKind("llm_call")!.configSchema!.find((f) => f.key === "temperature");
    expect(field).toMatchObject({ type: "number", min: 0, max: 2 });
  });

  test("importing an llm_call saved without config does not invent a temperature", () => {
    const { graph } = importWorkflow(llmCallDoc());
    const llm = graph.nodes.find((n) => n.id === "llm")!;
    expect((llm.data as { config: Record<string, unknown> }).config).not.toHaveProperty("temperature");
  });

  test("an explicit temperature survives import and export unchanged", () => {
    const { graph } = importWorkflow(llmCallDoc({ model: "m", prompt: "p", temperature: 0.7 }));
    const llm = graph.nodes.find((n) => n.id === "llm")!;
    expect((llm.data as { config: Record<string, unknown> }).config.temperature).toBe(0.7);

    const out = exportWorkflow(graph);
    const saved = out.graph.nodes.find((n) => n.id === "llm")!;
    expect(saved.config?.temperature).toBe(0.7);
  });
});
