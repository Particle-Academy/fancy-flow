import { beforeEach, describe, expect, it } from "vitest";
import { resolveNodePorts, resolvePortSpec } from "../src/registry/ports";
import { getNodeKind, registerNodeKind, validateConfig } from "../src/registry/registry";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { ExecutorRegistry, FlowGraph, PortDescriptor } from "../src/types";

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as FlowGraph["nodes"][number];
const edge = (id: string, source: string, target: string, sourceHandle?: string) =>
  ({ id, source, target, sourceHandle }) as FlowGraph["edges"][number];

describe("resolvePortSpec", () => {
  it("passes a static list straight through", () => {
    const ports: PortDescriptor[] = [{ id: "a" }, { id: "b" }];
    expect(resolvePortSpec(ports, {})).toEqual(ports);
  });

  it("derives ports from config when given a function", () => {
    const spec = (c: { n: number }) => Array.from({ length: c.n }, (_, i) => ({ id: `p${i}` }));
    expect(resolvePortSpec(spec, { n: 3 }).map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
  });

  it("degrades to undeclared when an author's port function throws", () => {
    // Contained rather than fatal: this runs on every canvas render AND inside
    // a live run, so a bad config must not blank the editor or abort the flow.
    const spec = () => {
      throw new Error("bad config");
    };
    expect(resolvePortSpec(spec as any, {})).toBeUndefined();
  });
});

describe("resolveNodePorts", () => {
  it("lets an explicit data override beat the kind declaration", () => {
    const kind = { outputs: [{ id: "from-kind" }] };
    const n = { data: { outputs: [{ id: "from-data" }] } } as any;
    expect(resolveNodePorts(n, kind).outputs).toEqual([{ id: "from-data" }]);
  });

  it("resolves a config-driven kind spec against the node's own config", () => {
    const kind = { outputs: (c: any) => (c.mode === "wide" ? [{ id: "x" }, { id: "y" }] : [{ id: "x" }]) };
    const n = { data: { config: { mode: "wide" } } } as any;
    expect(resolveNodePorts(n, kind).outputs?.map((p) => p.id)).toEqual(["x", "y"]);
  });

  it("reports nothing declared when neither data nor kind supplies ports", () => {
    expect(resolveNodePorts({ data: {} } as any, {})).toEqual({ inputs: undefined, outputs: undefined });
  });
});

describe("builtin config-driven ports", () => {
  beforeEach(() => registerBuiltinKinds());

  it("keeps switch_case's historical ports for the shipped default config", () => {
    // The old static declaration was case_a/"a", case_b/"b", default. Deriving
    // from `cases` must reproduce it exactly, or existing graphs lose edges.
    const kind = getNodeKind("switch_case")!;
    const ports = resolvePortSpec(kind.outputs, { cases: { a: "case_a", b: "case_b" } });
    expect(ports).toEqual([
      { id: "case_a", label: "a" },
      { id: "case_b", label: "b" },
      { id: "default", label: "default" },
    ]);
  });

  it("collapses several match values routing to one port", () => {
    const kind = getNodeKind("switch_case")!;
    const ports = resolvePortSpec(kind.outputs, { cases: { a: "hot", c: "hot", b: "cold" } });
    expect(ports?.map((p) => p.id)).toEqual(["hot", "cold", "default"]);
    expect(ports?.[0].label).toBe("a|c");
  });

  it("always keeps a default port, even with no cases configured", () => {
    const kind = getNodeKind("switch_case")!;
    expect(resolvePortSpec(kind.outputs, {})).toEqual([{ id: "default", label: "default" }]);
  });

  it("turns llm_branch routes into ports and drops blanks/duplicates", () => {
    const kind = getNodeKind("llm_branch")!;
    const ports = resolvePortSpec(kind.outputs, {
      routes: [{ port: "billing" }, { port: "" }, { port: "billing" }, { port: "support" }],
      fallback: true,
    });
    expect(ports?.map((p) => p.id)).toEqual(["billing", "support", "fallback"]);
  });

  it("omits llm_branch's fallback port when it is switched off", () => {
    const kind = getNodeKind("llm_branch")!;
    const ports = resolvePortSpec(kind.outputs, { routes: [{ port: "a" }], fallback: false });
    expect(ports?.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("runtime honours config-driven ports", () => {
  // The regression this guards: the canvas resolved ports through the kind,
  // the runtime read `node.data.outputs` only and fell back to a lone `out`.
  // A config-driven branch therefore DREW correctly and then routed as if it
  // had a single output — silently dropping every branch edge at execution.
  beforeEach(() => registerBuiltinKinds());

  it("activates ports the kind derives from config, with nothing on node.data", () => {
    registerNodeKind({
      name: "fanout",
      category: "logic",
      label: "Fan out",
      outputs: (c: any) => (c?.targets ?? []).map((id: string) => ({ id })),
    });

    const n = node("f", "fanout", { kind: "fanout", config: { targets: ["left", "right"] } });
    const ports = resolveNodePorts(n, getNodeKind("fanout")!).outputs;
    expect(ports?.map((p) => p.id)).toEqual(["left", "right"]);
  });

  it("routes a run down every config-derived edge", async () => {
    registerNodeKind({
      name: "fanout",
      category: "logic",
      label: "Fan out",
      outputs: (c: any) => (c?.targets ?? []).map((id: string) => ({ id })),
    });

    const graph: FlowGraph = {
      nodes: [
        // No `outputs` on data — the ports exist ONLY in config.
        node("f", "fanout", { kind: "fanout", config: { targets: ["left", "right"] } }),
        node("l", "action"),
        node("r", "action"),
      ],
      edges: [edge("e1", "f", "l", "left"), edge("e2", "f", "r", "right")],
    };

    const ran: string[] = [];
    const executors: ExecutorRegistry = {
      fanout: () => ({ ok: true }),
      action: ({ node }) => {
        ran.push(node.id);
        return { id: node.id };
      },
    };

    const result = await runFlow(graph, executors);

    expect(result.ok).toBe(true);
    expect(ran).toEqual(expect.arrayContaining(["l", "r"]));
  });

  it("still falls back to `out` for a node that declares no ports at all", async () => {
    const graph: FlowGraph = {
      nodes: [node("a", "action"), node("b", "action")],
      edges: [edge("e1", "a", "b")],
    };
    const ran: string[] = [];
    const executors: ExecutorRegistry = {
      action: ({ node }) => {
        ran.push(node.id);
        return {};
      },
    };
    const result = await runFlow(graph, executors);
    expect(result.ok).toBe(true);
    expect(ran).toEqual(["a", "b"]);
  });
});

describe("validateConfig — repeater / keyvalue", () => {
  const repeaterKind = {
    name: "t",
    category: "custom" as const,
    label: "T",
    configSchema: [
      {
        type: "repeater" as const,
        key: "rows",
        label: "Rows",
        minItems: 1,
        maxItems: 2,
        fields: [
          { type: "text" as const, key: "key", label: "Key", required: true },
          { type: "number" as const, key: "n", label: "N", min: 0 },
        ],
      },
    ],
  };

  it("accepts a well-formed list", () => {
    expect(validateConfig(repeaterKind, { rows: [{ key: "a", n: 1 }] })).toEqual([]);
  });

  it("rejects a non-list", () => {
    expect(validateConfig(repeaterKind, { rows: { key: "a" } })[0].message).toMatch(/must be a list/);
  });

  it("names the offending row so the author knows which one", () => {
    const issues = validateConfig(repeaterKind, { rows: [{ key: "a" }, { key: "" }] });
    expect(issues[0].message).toContain("item 2");
    expect(issues[0].message).toMatch(/Key is required/);
  });

  it("enforces row bounds", () => {
    expect(validateConfig(repeaterKind, { rows: [] })[0].message).toMatch(/at least 1/);
    expect(
      validateConfig(repeaterKind, { rows: [{ key: "a" }, { key: "b" }, { key: "c" }] })[0].message,
    ).toMatch(/at most 2/);
  });

  it("validates nested row fields with their own rules", () => {
    const issues = validateConfig(repeaterKind, { rows: [{ key: "a", n: -5 }] });
    expect(issues[0].message).toMatch(/item 1/);
    expect(issues[0].message).toMatch(/>= 0/);
  });

  const kvKind = {
    name: "kv",
    category: "custom" as const,
    label: "KV",
    configSchema: [
      {
        type: "keyvalue" as const,
        key: "map",
        label: "Map",
        valueOptions: [{ value: "x", label: "X" }],
      },
    ],
  };

  it("accepts a string map inside the allowed value set", () => {
    expect(validateConfig(kvKind, { map: { a: "x" } })).toEqual([]);
  });

  it("rejects a value outside the allowed set", () => {
    expect(validateConfig(kvKind, { map: { a: "nope" } })[0].message).toMatch(/must be one of x/);
  });

  it("rejects an array masquerading as a map", () => {
    expect(validateConfig(kvKind, { map: ["a"] })[0].message).toMatch(/key\/value map/);
  });
});

describe("schema carries resolved ports (cross-runtime parity)", () => {
  beforeEach(() => registerBuiltinKinds());

  it("writes a config-driven kind's ACTUAL ports into the exported document", async () => {
    // A runtime in another language cannot execute a JS port function. If the
    // document does not carry the resolved ports, the PHP twin sees none,
    // falls back to a single `out`, and every branch edge stops firing —
    // breaking the "same schema in, same routing out" guarantee.
    const { exportWorkflow } = await import("../src/schema/workflow-schema");
    const graph: FlowGraph = {
      nodes: [
        node("sw", "switch_case", {
          kind: "switch_case",
          config: { value: "{{ $json.k }}", cases: { a: "case_a", b: "case_b" } },
        }),
      ],
      edges: [],
    };

    const doc = exportWorkflow(graph);
    const exported = doc.graph.nodes[0];
    expect(exported.outputs?.map((p) => p.id)).toEqual(["case_a", "case_b", "default"]);
  });

  it("round-trips those ports back onto the node", async () => {
    const { exportWorkflow, importWorkflow } = await import("../src/schema/workflow-schema");
    const graph: FlowGraph = {
      nodes: [
        node("sw", "switch_case", {
          kind: "switch_case",
          config: { value: "{{ $json.k }}", cases: { a: "case_a" } },
        }),
      ],
      edges: [],
    };

    const back = importWorkflow(exportWorkflow(graph));
    const outputs = (back.graph.nodes[0]!.data as any).outputs;
    expect(outputs.map((p: { id: string }) => p.id)).toEqual(["case_a", "default"]);
  });

  it("exports llm_branch routes as ports", async () => {
    const { exportWorkflow } = await import("../src/schema/workflow-schema");
    const graph: FlowGraph = {
      nodes: [
        node("r", "llm_branch", {
          kind: "llm_branch",
          config: { routes: [{ port: "billing" }, { port: "support" }], fallback: true },
        }),
      ],
      edges: [],
    };
    const exported = exportWorkflow(graph).graph.nodes[0];
    expect(exported.outputs?.map((p) => p.id)).toEqual(["billing", "support", "fallback"]);
  });
});

describe("namespaced kind ids (#2)", () => {
  beforeEach(() => registerBuiltinKinds());

  it("gives every builtin a namespaced canonical id", async () => {
    const { BUILTIN_KINDS } = await import("../src/registry/builtin");
    for (const kind of BUILTIN_KINDS) {
      expect(kind.name.startsWith("@fancy/"), kind.name).toBe(true);
    }
  });

  it("still resolves the bare pre-namespace name", () => {
    // Every graph saved before this change carries the bare id. If these stop
    // resolving, those documents open as unknown nodes — the exact
    // un-migratable failure namespacing exists to prevent.
    expect(getNodeKind("switch_case")?.name).toBe("@fancy/switch_case");
    expect(getNodeKind("llm_branch")?.name).toBe("@fancy/llm_branch");
    expect(getNodeKind("manual_trigger")?.name).toBe("@fancy/manual_trigger");
  });

  it("resolves the canonical id too", () => {
    expect(getNodeKind("@fancy/switch_case")?.name).toBe("@fancy/switch_case");
  });

  it("returns null for an unknown id rather than guessing", () => {
    expect(getNodeKind("@acme/not_installed")).toBeNull();
    expect(getNodeKind("totally_unknown")).toBeNull();
  });

  it("lets a third-party kind claim its own namespace without colliding", async () => {
    const { resolveKindId } = await import("../src/registry/registry");
    registerNodeKind({ name: "@acme/llm_branch", category: "ai", label: "Acme Router" });

    // Two packages, same short name, no ambiguity.
    expect(resolveKindId("@acme/llm_branch")).toBe("@acme/llm_branch");
    expect(resolveKindId("@fancy/llm_branch")).toBe("@fancy/llm_branch");
    // The bare alias still belongs to whoever registered it as an alias.
    expect(resolveKindId("llm_branch")).toBe("@fancy/llm_branch");
  });

  it("canonicalises a pre-namespace document on import", async () => {
    const { importWorkflow } = await import("../src/schema/workflow-schema");
    const doc = {
      $schema: "https://particle.academy/schemas/workflow/v1.json",
      version: 1,
      graph: {
        nodes: [{ id: "sw", kind: "switch_case", position: { x: 0, y: 0 }, config: {} }],
        edges: [],
      },
    } as any;

    const back = importWorkflow(doc);
    const node = back.graph.nodes[0]!;
    expect(node.type).toBe("@fancy/switch_case");
    expect((node.data as any).kind).toBe("@fancy/switch_case");
  });

  it("keys the xyflow node-type map on aliases as well as canonical ids", async () => {
    const { buildNodeTypes } = await import("../src/registry");
    const types = buildNodeTypes();
    // xyflow resolves the renderer from `node.type` before any alias handling,
    // so a graph still carrying bare types must find one.
    expect(types["@fancy/switch_case"]).toBeDefined();
    expect(types["switch_case"]).toBeDefined();
  });

  it("unregisters a kind's aliases with it", async () => {
    const { resolveKindId } = await import("../src/registry/registry");
    const off = registerNodeKind({ name: "@tmp/thing", category: "custom", label: "T", aliases: ["thing"] });
    expect(resolveKindId("thing")).toBe("@tmp/thing");
    off();
    expect(resolveKindId("thing")).toBeNull();
  });
});

describe("executor binding survives namespacing", () => {
  beforeEach(() => registerBuiltinKinds());

  it("matches an executor bound under the BARE name after the rename", async () => {
    // The trap: canonicalising node.type to "@fancy/switch_case" would stop
    // matching every host that bound executors["switch_case"] — the node just
    // stops running, with no error. A rename must not break bindings.
    const graph: FlowGraph = {
      nodes: [node("sw", "@fancy/switch_case", { kind: "@fancy/switch_case", config: {} })],
      edges: [],
    };
    let ran = false;
    const result = await runFlow(graph, { switch_case: () => { ran = true; return {}; } });
    expect(result.ok).toBe(true);
    expect(ran).toBe(true);
  });

  it("matches an executor bound under the CANONICAL name", async () => {
    const graph: FlowGraph = {
      nodes: [node("sw", "@fancy/switch_case", { kind: "@fancy/switch_case", config: {} })],
      edges: [],
    };
    let ran = false;
    const result = await runFlow(graph, { "@fancy/switch_case": () => { ran = true; return {}; } });
    expect(result.ok).toBe(true);
    expect(ran).toBe(true);
  });

  it("still prefers a per-node id binding over the kind", async () => {
    const graph: FlowGraph = {
      nodes: [node("sw", "@fancy/switch_case", { kind: "@fancy/switch_case", config: {} })],
      edges: [],
    };
    const order: string[] = [];
    await runFlow(graph, {
      sw: () => { order.push("by-id"); return {}; },
      switch_case: () => { order.push("by-kind"); return {}; },
    });
    expect(order).toEqual(["by-id"]);
  });
});
