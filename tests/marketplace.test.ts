import { describe, it, expect } from "vitest";
import {
  validateNodeManifest,
  checkRuntimeSupport,
  checkCapabilities,
  NODE_MANIFEST_SCHEMA_VERSION,
} from "../src/marketplace/manifest";
import { runFixtures, validateFixtureFile, type FixtureFile } from "../src/marketplace/fixtures";
import { registerBuiltinKinds, registerNodeKind } from "../src/registry";
import { pauseForHuman } from "../src/registry/pause";
import type { NodeExecutor } from "../src/types";

registerBuiltinKinds();

const valid = {
  schemaVersion: NODE_MANIFEST_SCHEMA_VERSION,
  name: "@acme/fancy-flow-salesforce",
  kind: "@acme/salesforce_upsert",
  fancyFlow: ">=0.14.0",
  runtimes: { ts: "dist/executor.js", php: "acme/fancy-flow-salesforce:^0.1" },
  fixtures: "fixtures/salesforce_upsert.json",
};

describe("manifest validation", () => {
  it("accepts a complete manifest", () => {
    const result = validateNodeManifest(valid);
    expect(result.ok).toBe(true);
    expect(result.manifest?.kind).toBe("@acme/salesforce_upsert");
  });

  it("reports every problem at once, not just the first", () => {
    // An author fixing a package wants the whole list — one error per run
    // turns a five-minute fix into five round trips.
    const result = validateNodeManifest({ schemaVersion: 1 });
    const fields = result.problems.map((p) => p.field);
    expect(result.ok).toBe(false);
    expect(fields).toEqual(expect.arrayContaining(["name", "kind", "fancyFlow", "runtimes", "fixtures"]));
  });

  it("rejects a bare, un-namespaced kind id", () => {
    // The one mistake that cannot be fixed later: the ambiguous string is
    // already written into saved documents.
    const result = validateNodeManifest({ ...valid, kind: "salesforce_upsert" });
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.field === "kind")?.message).toMatch(/namespaced/);
  });

  it("warns rather than fails when a package claims the first-party scope", () => {
    const result = validateNodeManifest({ ...valid, kind: "@particle-academy/salesforce_upsert" });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([
      expect.objectContaining({ level: "warning", field: "kind" }),
    ]);
  });

  it("refuses an author-set verified flag", () => {
    const result = validateNodeManifest({ ...valid, verified: true });
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.field === "verified")?.message).toMatch(/cannot vouch for itself/);
  });

  it("requires fixtures — the publish gate", () => {
    const { fixtures, ...withoutFixtures } = valid;
    void fixtures;
    const result = validateNodeManifest(withoutFixtures);
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.field === "fixtures")).toBeDefined();
  });

  it("rejects a node implementing no runtime", () => {
    const result = validateNodeManifest({ ...valid, runtimes: {} });
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.field === "runtimes")?.message).toMatch(/cannot execute anywhere/);
  });

  it("stops at an unknown schema version instead of guessing the rest", () => {
    const result = validateNodeManifest({ schemaVersion: 99 });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0].message).toMatch(/Upgrade fancy-flow/);
  });

  it.each([[null], [[]], ["a string"], [42]])("rejects a non-object manifest (%s)", (input) => {
    expect(validateNodeManifest(input).ok).toBe(false);
  });
});

describe("runtime support", () => {
  it("passes when the node implements every runtime the host executes on", () => {
    expect(checkRuntimeSupport(valid, ["ts", "php"])).toEqual([]);
  });

  it("catches the TS-only package on a PHP host", () => {
    // The exact gap MOIC hit: the node installs, appears in the palette, and
    // then cannot run — with nothing visible beforehand.
    const problems = checkRuntimeSupport({ kind: "@acme/x", runtimes: { ts: "dist/x.js" } }, ["php"]);
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("error");
    expect(problems[0].message).toMatch(/executes on php/);
  });

  it("does not complain about a runtime the host does not use", () => {
    expect(checkRuntimeSupport(valid, ["ts"])).toEqual([]);
  });
});

describe("capability checks", () => {
  it("warns, not errors, about an unwired capability", () => {
    // Install is the right time to learn what to wire, not a reason to refuse.
    const problems = checkCapabilities({ kind: "@acme/x", capabilities: ["llm"] }, { llm: false });
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("warning");
  });

  it("is silent when everything is wired", () => {
    expect(checkCapabilities({ kind: "@acme/x", capabilities: ["llm"] }, { llm: true })).toEqual([]);
  });
});

describe("fixture file validation", () => {
  it("rejects an empty case list", () => {
    expect(validateFixtureFile({ kind: "@acme/x", cases: [] })).toEqual([
      expect.stringMatching(/empty fixture file proves nothing/),
    ]);
  });

  it("rejects a case that asserts nothing", () => {
    const problems = validateFixtureFile({ kind: "@acme/x", cases: [{ name: "n", expect: {} }] });
    expect(problems).toEqual([expect.stringMatching(/must assert at least one/)]);
  });

  it("catches a fixture file for a different kind than the manifest declares", () => {
    const problems = validateFixtureFile({ kind: "@acme/y", cases: [{ name: "n", expect: { ports: ["out"] } }] }, "@acme/x");
    expect(problems).toEqual([expect.stringMatching(/manifest declares/)]);
  });

  it("accepts a well-formed file", () => {
    expect(validateFixtureFile({ kind: "@acme/x", cases: [{ name: "n", expect: { ports: ["out"] } }] }, "@acme/x")).toEqual([]);
  });
});

describe("running fixtures asserts reachability, not intent", () => {
  // A router that declares three ports and picks one.
  registerNodeKind({
    name: "@test/router",
    category: "action",
    label: "Test Router",
    outputs: (config: any) => (config?.routes ?? ["a", "b"]).map((id: string) => ({ id })),
  });

  const routerTo = (port: string): NodeExecutor => () => ({ __port: port, value: { picked: port } });

  const file = (cases: FixtureFile["cases"]): FixtureFile => ({ kind: "@test/router", cases });

  it("passes when only the chosen port reaches a downstream node", async () => {
    const result = await runFixtures(
      file([{ name: "routes to b", config: { routes: ["a", "b", "c"] }, expect: { ports: ["b"] } }]),
      routerTo("b"),
    );
    expect(result.ok).toBe(true);
    expect(result.passed).toBe(1);
  });

  it("FAILS when the node records a port that has no reachable downstream", async () => {
    // The 0.9.0 lesson, encoded: a test reading back `__port` stays green here.
    // Only a probe on the edge catches it.
    const result = await runFixtures(
      file([{ name: "claims c", config: { routes: ["a", "b"] }, expect: { ports: ["c"] } }]),
      routerTo("c"),
    );
    expect(result.ok).toBe(false);
    expect(result.failures[0].message).toMatch(/expected these ports to reach a downstream node/);
  });

  it("fails a node that fires an extra port, not just one that fires none", async () => {
    const fanOut: NodeExecutor = () => ({ some: "value" });
    const result = await runFixtures(
      file([{ name: "should route one way", config: { routes: ["a", "b"] }, expect: { ports: ["a"] } }]),
      fanOut,
    );
    expect(result.ok).toBe(false);
    expect(result.failures[0].message).toMatch(/\[a, b\] did/);
  });

  it("checks the value carried downstream", async () => {
    const result = await runFixtures(
      file([{ name: "carries", config: { routes: ["a"] }, expect: { ports: ["a"], value: { picked: "a" } } }]),
      routerTo("a"),
    );
    expect(result.ok).toBe(true);
  });

  it("reports a value mismatch", async () => {
    const result = await runFixtures(
      file([{ name: "carries", config: { routes: ["a"] }, expect: { value: { picked: "z" } } }]),
      routerTo("a"),
    );
    expect(result.ok).toBe(false);
    expect(result.failures[0].message).toMatch(/carried downstream/);
  });

  it("asserts a pause", async () => {
    const pauses: NodeExecutor = (ctx) => pauseForHuman(ctx as any, "input", { fields: ["email"] });
    const result = await runFixtures(
      file([{ name: "waits", expect: { pause: { awaiting: "input", detail: { fields: ["email"] } } } }]),
      pauses,
    );
    expect(result.ok).toBe(true);
  });

  it("does not accept a failure as a pause", async () => {
    const throws: NodeExecutor = () => {
      throw new Error("database is down");
    };
    const result = await runFixtures(file([{ name: "waits", expect: { pause: { awaiting: "input" } } }]), throws);
    expect(result.ok).toBe(false);
    expect(result.failures[0].message).toMatch(/expected a pause/);
  });

  it("asserts an expected error", async () => {
    const throws: NodeExecutor = () => {
      throw new Error("credential missing");
    };
    const result = await runFixtures(file([{ name: "errors", expect: { error: "credential" } }]), throws);
    expect(result.ok).toBe(true);
  });

  it("catches what a __port assertion cannot — the silent 0.9.0 failure mode", async () => {
    // This is the justification for probes, demonstrated rather than asserted.
    // The subject emits on a port with NO edge. The engine records the choice,
    // reports the run as SUCCESSFUL, and nothing downstream ever runs.
    //
    // A test reading `outputs.subject.__port` sees "c" and passes. A test
    // reading `result.ok` sees true and passes. Only reachability catches it —
    // which is exactly how a real routing divergence escaped into production.
    const graph = await (async () => {
      const fired: string[] = [];
      const { runFlow } = await import("../src/runtime/run-flow");
      const result = await runFlow(
        {
          nodes: [
            { id: "t", type: "manual_trigger", position: { x: 0, y: 0 }, data: {} },
            { id: "subject", type: "@test/router", position: { x: 0, y: 1 }, data: {} },
            { id: "probe:a", type: "@particle-academy/transform", position: { x: 0, y: 2 }, data: {} },
          ],
          edges: [
            { id: "e0", source: "t", target: "subject" },
            { id: "ea", source: "subject", sourceHandle: "a", target: "probe:a" },
          ],
        } as any,
        {
          manual_trigger: () => ({}),
          "@test/router": () => ({ __port: "c", value: 1 }),
          "probe:a": () => {
            fired.push("a");
          },
        } as any,
        () => {},
      );
      return { result, fired };
    })();

    expect((graph.result.outputs.subject as any).__port).toBe("c"); // a __port test: GREEN
    expect(graph.result.ok).toBe(true); // a status test: GREEN
    expect(graph.fired).toEqual([]); // reachability: nothing ran

    // And the fixture runner, which asserts reachability, fails it.
    const viaFixtures = await runFixtures(
      file([{ name: "claims c", config: { routes: ["a"] }, expect: { ports: ["c"] } }]),
      (() => ({ __port: "c", value: 1 })) as NodeExecutor,
    );
    expect(viaFixtures.ok).toBe(false);
  });

  it("counts passes and collects every failure across cases", async () => {
    const result = await runFixtures(
      file([
        { name: "ok", config: { routes: ["a"] }, expect: { ports: ["a"] } },
        { name: "bad", config: { routes: ["a"] }, expect: { ports: ["zzz"] } },
      ]),
      routerTo("a"),
    );
    expect(result.passed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].case).toBe("bad");
  });
});
