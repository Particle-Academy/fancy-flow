import { describe, it, expect } from "vitest";
import {
  validateNodeManifest,
  checkRuntimeSupport,
  checkCapabilities,
  satisfiesRange,
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
  runtimes: {
    ts: { entry: "dist/executor.js", engine: "^0.15" },
    php: { package: "acme/fancy-flow-salesforce:^0.1", engine: "^0.7" },
  },
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
    expect(fields).toEqual(expect.arrayContaining(["name", "kind", "runtimes", "fixtures"]));
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
    expect(result.problems).toEqual([expect.objectContaining({ level: "warning", field: "kind" })]);
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

describe("per-runtime engine ranges", () => {
  // The flaw MOIC found in the first cut: one range cannot say "needs ts
  // >=0.15 AND php >=0.7", so a package installs cleanly against a host whose
  // OTHER runtime is too old.
  it("rejects a leftover single fancyFlow range and says where the range belongs", () => {
    const result = validateNodeManifest({ ...valid, fancyFlow: ">=0.10.1" });
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.field === "fancyFlow")?.message).toMatch(/into each entry of/);
  });

  it("requires an engine range on every runtime", () => {
    const result = validateNodeManifest({ ...valid, runtimes: { ts: { entry: "dist/x.js" } } });
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.field === "runtimes.ts.engine")?.message).toMatch(/too old to run it/);
  });

  it("needs entry or package, and refuses both", () => {
    const missing = validateNodeManifest({ ...valid, runtimes: { ts: { engine: "^0.15" } } });
    expect(missing.problems.find((p) => p.field === "runtimes.ts")?.message).toMatch(/module path/);

    const both = validateNodeManifest({
      ...valid,
      runtimes: { ts: { entry: "a.js", package: "a/b:^1", engine: "^0.15" } },
    });
    expect(both.problems.find((p) => p.field === "runtimes.ts")?.message).toMatch(/not both/);
  });
});

describe("aliases, configVersion, sideEffects", () => {
  it("accepts a package declaring its own aliases", () => {
    // Core renamed llm_branch and kept old ids working. Third parties rename
    // too, and without this only first-party nodes could do it safely.
    const result = validateNodeManifest({ ...valid, aliases: ["@acme/salesforce_write", "salesforce_upsert"] });
    expect(result.ok).toBe(true);
  });

  it("rejects malformed aliases", () => {
    expect(validateNodeManifest({ ...valid, aliases: ["", 7] }).ok).toBe(false);
  });

  it("accepts a configVersion and rejects a non-integer one", () => {
    expect(validateNodeManifest({ ...valid, configVersion: 2 }).ok).toBe(true);
    expect(validateNodeManifest({ ...valid, configVersion: 1.5 }).ok).toBe(false);
  });

  it.each([["none"], ["idempotent"], ["unsafe-to-replay"]])("accepts sideEffects=%s", (value) => {
    expect(validateNodeManifest({ ...valid, sideEffects: value }).ok).toBe(true);
  });

  it("rejects an unknown sideEffects value", () => {
    // Durable runs retry; a host reads this to pick a retry policy per node.
    expect(validateNodeManifest({ ...valid, sideEffects: "sometimes" }).ok).toBe(false);
  });
});

describe("runtime support", () => {
  it("passes when the node implements every runtime the host executes on", () => {
    expect(checkRuntimeSupport(valid, ["ts", "php"], { ts: "0.15.1", php: "0.7.0" })).toEqual([]);
  });

  it("catches the TS-only package on a PHP host", () => {
    // The exact gap MOIC hit: the node installs, appears in the palette, and
    // then cannot run — with nothing visible beforehand.
    const problems = checkRuntimeSupport(
      { kind: "@acme/x", runtimes: { ts: { entry: "dist/x.js", engine: "^0.15" } } },
      ["php"],
    );
    expect(problems[0].level).toBe("error");
    expect(problems[0].message).toMatch(/executes on php/);
  });

  it("catches a host whose OTHER runtime is too old", () => {
    // The failure a single range could not express.
    const problems = checkRuntimeSupport(valid, ["ts", "php"], { ts: "0.15.1", php: "0.5.0" });
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("error");
    expect(problems[0].field).toBe("runtimes.php.engine");
    expect(problems[0].message).toMatch(/needs php engine/);
  });

  it("warns rather than passing silently when the host reports no version", () => {
    // "We did not check" and "it is fine" must not look the same.
    const problems = checkRuntimeSupport(valid, ["ts"], {});
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("warning");
    expect(problems[0].message).toMatch(/was not checked/);
  });
});

describe("satisfiesRange", () => {
  it.each([
    ["0.15.1", "^0.15", true],
    ["0.16.0", "^0.15", false],
    ["1.2.0", "^1.0", true],
    ["2.0.0", "^1.0", false],
    ["0.7.0", ">=0.7", true],
    ["0.5.0", ">=0.7", false],
    ["0.7.3", "~0.7.1", true],
    ["0.8.0", "~0.7.1", false],
    ["9.9.9", "*", true],
    ["0.7.0", "^0.5 || ^0.7", true],
  ])("%s against %s is %s", (version, range, expected) => {
    expect(satisfiesRange(version as string, range as string)).toBe(expected);
  });

  it("treats an unparseable range as unsatisfied rather than waving it through", () => {
    expect(satisfiesRange("1.0.0", "not-a-range")).toBe(false);
  });
});

describe("capability requirement levels", () => {
  it("errors on a missing REQUIRED capability", () => {
    // The point of the level: surfaced at author time so an editor can grey the
    // node, instead of it installing cleanly and silently no-opping at run time.
    const problems = checkCapabilities({ kind: "@acme/x", capabilities: { llm: "required" } }, { llm: false });
    expect(problems).toHaveLength(1);
    expect(problems[0].level).toBe("error");
    expect(problems[0].message).toMatch(/cannot run here/);
  });

  it("only warns on a missing OPTIONAL capability", () => {
    const problems = checkCapabilities({ kind: "@acme/x", capabilities: { doc: "optional" } }, { doc: false });
    expect(problems[0].level).toBe("warning");
    expect(problems[0].message).toMatch(/reduced behaviour/);
  });

  it("is silent when everything is wired", () => {
    expect(checkCapabilities({ kind: "@acme/x", capabilities: { llm: "required" } }, { llm: true })).toEqual([]);
  });

  it("rejects a bare capability list, which cannot express the level", () => {
    const result = validateNodeManifest({ ...valid, capabilities: ["llm"] });
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.field === "capabilities")?.message).toMatch(/bare list/);
  });

  it("rejects an unknown requirement level", () => {
    expect(validateNodeManifest({ ...valid, capabilities: { llm: "maybe" } }).ok).toBe(false);
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
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/must assert at least one/)]));
  });

  it("catches a fixture file for a different kind than the manifest declares", () => {
    const problems = validateFixtureFile({ kind: "@acme/y", cases: [{ name: "n", expect: { ports: ["out"] } }] }, "@acme/x");
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/manifest declares/)]));
  });

  it("accepts a well-formed file", () => {
    const file = {
      kind: "@acme/x",
      cases: [
        { name: "happy", expect: { ports: ["out"] } },
        { name: "sad", expect: { error: "boom" } },
      ],
    };
    expect(validateFixtureFile(file, "@acme/x")).toEqual([]);
  });

  it("requires at least one failure or pause case", () => {
    // "Does it fail the same way" deserves equal weight to "does it succeed the
    // same way" — the incident behind this whole mechanism was a FAILURE that
    // reported completed with no error.
    const allHappy = { kind: "@acme/x", cases: [{ name: "happy", expect: { ports: ["out"] } }] };
    expect(validateFixtureFile(allHappy)).toEqual([
      expect.stringMatching(/at least one case must assert a failure/i),
    ]);
  });

  it.each([["error"], ["pause"]])("accepts %s as the failure coverage", (key) => {
    const expectation = key === "error" ? { error: "boom" } : { pause: { awaiting: "input" } };
    const file = { kind: "@acme/x", cases: [{ name: "sad", expect: expectation }] };
    expect(validateFixtureFile(file)).toEqual([]);
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

describe("fixture stubs, resume, events, legacy ids", () => {
  registerNodeKind({
    name: "@test/waiter",
    category: "human",
    label: "Waiter",
    aliases: ["@test/old_waiter"],
    pausesForHuman: "signature",
    outputs: [{ id: "out" }],
  });

  const waiter: NodeExecutor = (ctx) => {
    const values = (ctx.inputs as Record<string, unknown>).values;
    if (values === undefined) pauseForHuman(ctx as any, "signature", { doc: "nda.pdf" });
    return values;
  };

  it("resumes a paused case with a submission and asserts the final state", async () => {
    // Pause/resume is the only path crossing a persistence boundary, so it is
    // where two runtimes are most likely to drift — and it had no coverage.
    const result = await runFixtures(
      {
        kind: "@test/waiter",
        cases: [
          {
            name: "waits then finishes",
            expect: {
              pause: { awaiting: "signature", detail: { doc: "nda.pdf" } },
              afterResume: { submit: { signedBy: "ada" }, ports: ["out"], value: { signedBy: "ada" } },
            },
          },
        ],
      },
      waiter,
    );

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails when the resumed run does not reach the expected state", async () => {
    const result = await runFixtures(
      {
        kind: "@test/waiter",
        cases: [
          {
            name: "wrong resume value",
            expect: {
              pause: { awaiting: "signature" },
              afterResume: { submit: { signedBy: "ada" }, value: { signedBy: "grace" } },
            },
          },
        ],
      },
      waiter,
    );

    expect(result.ok).toBe(false);
    expect(result.failures[0].message).toMatch(/after resume/);
  });

  it("runs a case against a legacy alias, proving the alias is real", async () => {
    // What stops `aliases` from being declared and then rotting.
    const result = await runFixtures(
      {
        kind: "@test/waiter",
        cases: [
          { name: "old id still resolves", legacyKind: "@test/old_waiter", expect: { pause: { awaiting: "signature" } } },
        ],
      },
      waiter,
    );

    expect(result.ok).toBe(true);
  });

  it("builds an llm_client stub from fixture data, so CI needs no provider", async () => {
    // If the stub format is not shared, each runtime stubs differently and the
    // fixtures stop comparing like with like — parity theatre.
    registerNodeKind({
      name: "@test/router2",
      category: "ai",
      label: "R2",
      outputs: () => [{ id: "billing" }, { id: "support" }],
    });

    const usesLlm: NodeExecutor = async () => {
      const { getLlmClient } = await import("../src/registry/capabilities");
      const choice = await getLlmClient()!.chooseRoute({ prompt: "?", routes: [{ port: "billing" }, { port: "support" }] });
      return { __port: choice.port, value: { reason: choice.reason } };
    };

    const result = await runFixtures(
      {
        kind: "@test/router2",
        cases: [
          {
            name: "routes to billing",
            stubs: { llm_client: { chooseRoute: { port: "billing", reason: "invoice question" } } },
            expect: { ports: ["billing"], value: { reason: "invoice question" } },
          },
        ],
      },
      usesLlm,
    );

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("asserts emitted events, so a warning contract cannot degrade silently", async () => {
    registerNodeKind({ name: "@test/warner", category: "action", label: "W", outputs: [{ id: "out" }] });

    const warns: NodeExecutor = (ctx) => {
      ctx.emit({ type: "log", nodeId: ctx.node.id, level: "warn", message: "model chose an unknown port; using fallback" });
      return { ok: true };
    };

    const file: FixtureFile = {
      kind: "@test/warner",
      cases: [
        {
          name: "warns on fallback",
          expect: { ports: ["out"], events: [{ type: "log", level: "warn", messageContains: "unknown port" }] },
        },
      ],
    };

    expect((await runFixtures(file, warns)).ok).toBe(true);

    // And it fails when the event is absent — otherwise the assertion is decor.
    const silent: NodeExecutor = () => ({ ok: true });
    const failed = await runFixtures(file, silent);
    expect(failed.ok).toBe(false);
    expect(failed.failures[0].message).toMatch(/expected an emitted event/);
  });
});
