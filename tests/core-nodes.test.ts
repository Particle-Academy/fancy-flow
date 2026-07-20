import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { getNodeKind } from "../src/registry/registry";
import { resolvePortSpec } from "../src/registry/ports";
import { registerLlmClient, registerWorkflowResolver } from "../src/registry/capabilities";
import { subflowExecutor, subflowMode, subflowPorts, DEFAULT_MAX_DEPTH } from "../src/registry/subflow";
import { llmRouterExecutor, declaredRoutes, resolveFallbackPort } from "../src/registry/llm-router";
import { runFlow } from "../src/runtime/run-flow";
import type { ExecutorRegistry, FlowGraph, RunEvent } from "../src/types";

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as FlowGraph["nodes"][number];
const edge = (id: string, source: string, target: string, sourceHandle?: string) =>
  ({ id, source, target, sourceHandle }) as FlowGraph["edges"][number];

const teardown: Array<() => void> = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

/** Minimal executor context for calling an executor directly. */
function ctx(config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const events: RunEvent[] = [];
  return {
    events,
    call: {
      node: node("n", "k", { config }) as never,
      inputs: {},
      abort: (reason?: string) => { throw new Error(reason ?? "aborted"); },
      emit: (e: RunEvent) => events.push(e),
      ...extra,
    } as never,
  };
}

describe("llm_router — a shuttle, not an engine", () => {
  beforeEach(() => registerBuiltinKinds());

  it("is a core builtin with an executor attached", () => {
    const kind = getNodeKind("llm_branch");
    expect(kind?.name).toBe("@particle-academy/llm_router");
    // Core ships the routing; the model call comes from the host's client.
    expect(kind?.executor).toBeTypeOf("function");
  });

  it("reads the declared routes out of config", () => {
    expect(declaredRoutes({ routes: [{ port: "a" }, { port: " " }, { port: "b" }] })).toEqual([
      { port: "a", description: undefined },
      { port: "b", description: undefined },
    ]);
  });

  it("asks the host's client and routes to its choice", async () => {
    teardown.push(registerLlmClient({ chooseRoute: () => ({ port: "billing", reason: "invoice" }) }));
    const c = ctx({ prompt: "help", routes: [{ port: "billing" }, { port: "support" }] });
    const out: any = await llmRouterExecutor(c.call);
    expect(out.__port).toBe("billing");
    expect(out.value.reason).toBe("invoice");
  });

  it("carries the reason down the chosen port so a run explains itself", async () => {
    teardown.push(registerLlmClient({ chooseRoute: () => ({ port: "a", reason: "because" }) }));
    const c = ctx({ prompt: "x", routes: [{ port: "a" }] });
    const out: any = await llmRouterExecutor(c.call);
    expect(out.value).toMatchObject({ route: "a", reason: "because" });
  });

  it("NEVER routes to a port the model invented", async () => {
    // Emitting on a port with no edge silently ends the branch and the run
    // reports success having done nothing — the worst failure in a workflow.
    teardown.push(registerLlmClient({ chooseRoute: () => ({ port: "totally-made-up" }) }));
    const c = ctx({ prompt: "x", routes: [{ port: "a" }, { port: "b" }], fallback: true });
    const out: any = await llmRouterExecutor(c.call);
    expect(out.__port).toBe("fallback");
    expect(c.events.some((e) => e.type === "log" && (e as any).level === "warn")).toBe(true);
  });

  it("falls back to the first route when the fallback port is switched off", async () => {
    teardown.push(registerLlmClient({ chooseRoute: () => ({ port: "nope" }) }));
    const c = ctx({ prompt: "x", routes: [{ port: "first" }, { port: "second" }], fallback: false });
    const out: any = await llmRouterExecutor(c.call);
    expect(out.__port).toBe("first");
  });

  it("resolveFallbackPort prefers the fallback port, else the first route", () => {
    expect(resolveFallbackPort([{ port: "a" }], true)).toBe("fallback");
    expect(resolveFallbackPort([{ port: "a" }], false)).toBe("a");
  });

  it("fails loudly when no client is registered rather than guessing a branch", async () => {
    const c = ctx({ prompt: "x", routes: [{ port: "a" }] });
    await expect(llmRouterExecutor(c.call)).rejects.toThrow(/registerLlmClient/);
  });

  it("aborts when no routes are configured", async () => {
    teardown.push(registerLlmClient({ chooseRoute: () => ({ port: "a" }) }));
    const c = ctx({ prompt: "x", routes: [] });
    await expect(llmRouterExecutor(c.call)).rejects.toThrow(/no routes/i);
  });

  it("imports no provider SDK into core", async () => {
    // The dependency argument for keeping this in core: it must stay a shuttle.
    const pkg = await import("../package.json");
    const deps = Object.keys((pkg as any).default?.dependencies ?? (pkg as any).dependencies ?? {});
    expect(deps.some((d) => /openai|anthropic|prism|langchain/i.test(d))).toBe(false);
  });
});

describe("subflow — run another workflow", () => {
  beforeEach(() => registerBuiltinKinds());

  it("is a core builtin", () => {
    const kind = getNodeKind("subflow");
    expect(kind?.name).toBe("@particle-academy/subflow");
    expect(kind?.executor).toBeTypeOf("function");
  });

  it("exposes a stream port only when it streams", () => {
    expect(subflowPorts({ mode: "output" }).map((p) => p.id)).toEqual(["out"]);
    expect(subflowPorts({ mode: "stream" }).map((p) => p.id)).toEqual(["stream", "out"]);
    expect(subflowPorts({ mode: "both" }).map((p) => p.id)).toEqual(["stream", "out"]);
  });

  it("derives those ports through the kind", () => {
    const kind = getNodeKind("subflow")!;
    expect(resolvePortSpec(kind.outputs, { mode: "both" })?.map((p) => p.id)).toEqual(["stream", "out"]);
  });

  it("defaults to output mode for an unknown value", () => {
    expect(subflowMode({})).toBe("output");
    expect(subflowMode({ mode: "nonsense" })).toBe("output");
  });

  it("runs the resolved child workflow and returns its outputs", async () => {
    const child: FlowGraph = {
      nodes: [node("c1", "action"), node("c2", "action")],
      edges: [edge("ce", "c1", "c2")],
    };
    teardown.push(registerWorkflowResolver(() => child));

    const c = ctx({ workflow: "child", mode: "output", executors: { action: ({ node }: any) => node.id } });
    const out: any = await subflowExecutor(c.call);
    expect(out.__port).toBe("out");
    expect(out.value).toMatchObject({ c1: "c1", c2: "c2" });
  });

  it("streams the child's progress onto the parent's feed", async () => {
    const child: FlowGraph = { nodes: [node("c1", "action")], edges: [] };
    teardown.push(registerWorkflowResolver(() => child));

    const c = ctx({ workflow: "child", mode: "stream", executors: { action: () => "ok" } });
    await subflowExecutor(c.call);

    const logs = c.events.filter((e) => e.type === "log") as any[];
    expect(logs.length).toBeGreaterThan(0);
    // Tagged with the reference, and attributed to the SUBFLOW node — a child's
    // node ids mean nothing in the parent graph.
    expect(logs[0].message).toContain("[child]");
    expect(logs[0].nodeId).toBe("n");
  });

  it("does not stream in output mode", async () => {
    const child: FlowGraph = { nodes: [node("c1", "action")], edges: [] };
    teardown.push(registerWorkflowResolver(() => child));
    const c = ctx({ workflow: "child", mode: "output", executors: { action: () => "ok" } });
    await subflowExecutor(c.call);
    expect(c.events.filter((e) => e.type === "log")).toHaveLength(0);
  });

  it("stops runaway recursion by name, not by stack overflow", async () => {
    // A workflow that references itself would otherwise recurse until the stack
    // dies, surfacing as an opaque crash instead of "you built a loop".
    teardown.push(registerWorkflowResolver(() => ({ nodes: [], edges: [] })));
    const c = ctx({ workflow: "loop", maxDepth: 3 }, { depth: 3 });
    await expect(subflowExecutor(c.call)).rejects.toThrow(/depth limit reached \(3\).*referencing itself/s);
  });

  it("uses a sane default depth limit", () => {
    expect(DEFAULT_MAX_DEPTH).toBeGreaterThan(1);
  });

  it("reports an unresolvable reference instead of running nothing", async () => {
    teardown.push(registerWorkflowResolver(() => null));
    const c = ctx({ workflow: "missing" });
    await expect(subflowExecutor(c.call)).rejects.toThrow(/could not resolve workflow "missing"/);
  });

  it("fails loudly with no resolver registered", async () => {
    const c = ctx({ workflow: "any" });
    await expect(subflowExecutor(c.call)).rejects.toThrow(/registerWorkflowResolver/);
  });

  it("surfaces a child failure rather than reporting success", async () => {
    const child: FlowGraph = { nodes: [node("boom", "action")], edges: [] };
    teardown.push(registerWorkflowResolver(() => child));
    const c = ctx({
      workflow: "child",
      executors: { action: () => { throw new Error("child exploded"); } },
    });
    await expect(subflowExecutor(c.call)).rejects.toThrow(/child exploded/);
  });

  it("threads depth into a real nested run", async () => {
    const seen: Array<number | undefined> = [];
    const graph: FlowGraph = { nodes: [node("a", "probe")], edges: [] };
    const executors: ExecutorRegistry = {
      probe: (c: any) => { seen.push(c.depth); return {}; },
    };
    await runFlow(graph, executors, () => {}, { depth: 2 });
    expect(seen).toEqual([2]);
  });
});

describe("config authoring surface", () => {
  beforeEach(() => registerBuiltinKinds());

  /** Fields an author has to hand-write as raw text rather than compose. */
  const RAW = new Set(["json", "expression"]);

  it("has no node whose config is ONLY raw json/expression", async () => {
    // A node configured solely by a hand-written blob pushes the authoring cost
    // onto every user and makes NodeConfigPanel stop being the single authoring
    // surface. Structured fields (repeater/keyvalue/select) exist for this.
    const { BUILTIN_KINDS } = await import("../src/registry/builtin");
    const offenders: string[] = [];

    for (const kind of BUILTIN_KINDS) {
      const schema = kind.configSchema ?? [];
      if (schema.length === 0) continue;
      if (schema.every((f) => RAW.has(f.type))) offenders.push(kind.name);
    }

    expect(offenders).toEqual([]);
  });

  it("only uses a json field where the value genuinely IS json", async () => {
    // The exception, and the whole exception: a JSON Schema and an HTTP JSON
    // body are json. A header map, a filter map and a tool list are not.
    const { BUILTIN_KINDS } = await import("../src/registry/builtin");
    const jsonFields: string[] = [];

    const walk = (fields: readonly any[]) => {
      for (const f of fields) {
        if (f.type === "json") jsonFields.push(f.key);
        if (f.type === "repeater") walk(f.fields ?? []);
      }
    };
    for (const kind of BUILTIN_KINDS) walk(kind.configSchema ?? []);

    // Keep this list short and justified. Adding to it should require an
    // argument, which is the point of asserting on it.
    expect([...new Set(jsonFields)].sort()).toEqual(["body", "input_schema"]);
  });

  it("gives branch a structured condition builder, not a bare expression", async () => {
    const kind = getNodeKind("branch")!;
    const types = (kind.configSchema ?? []).map((f) => f.type);
    expect(types).toContain("repeater");
    // The raw expression survives as a deliberate escape hatch, not the only way in.
    expect(types).toContain("expression");
  });
});
