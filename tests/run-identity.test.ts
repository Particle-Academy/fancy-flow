import { describe, expect, it } from "vitest";

import { runFlow } from "../src/runtime/run-flow";
import { RunIdentity } from "../src/runtime/run-identity";
import type { ExecutorRegistry, FlowGraph } from "../src/types";

const node = (id: string, type = "action") => ({ id, type, position: { x: 0, y: 0 }, data: {} });
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

describe("RunIdentity — composition", () => {
  it("keys a top-level node on the run and its own id", () => {
    expect(new RunIdentity("run_a").stepKey("pay")).toBe("run_a:pay");
  });

  it("keeps the SAME key across attempts of the same step", () => {
    // The whole point. A key that moves with the attempt creates a second
    // charge on the first timeout, which is the failure it exists to prevent.
    const first = new RunIdentity("run_a", [], 1);
    const retry = new RunIdentity("run_a", [], 5);

    expect(retry.stepKey("pay")).toBe(first.stepKey("pay"));
  });

  it("gives a different key to a different occurrence of the same node", () => {
    const id = new RunIdentity("run_a");
    expect(id.stepKey("pay", 0)).not.toBe(id.stepKey("pay", 1));
    expect(id.stepKey("pay", 0)).not.toBe(id.stepKey("pay"));
  });

  it("gives a different key to the same node in a different run", () => {
    expect(new RunIdentity("run_a").stepKey("pay")).not.toBe(
      new RunIdentity("run_b").stepKey("pay"),
    );
  });

  it("descends without colliding with a same-named node in the parent", () => {
    const parent = new RunIdentity("run_a");
    const child = parent.descend("billing");

    expect(child.stepKey("pay")).toBe("run_a:billing/pay");
    expect(child.stepKey("pay")).not.toBe(parent.stepKey("pay"));
  });

  it("carries attempt and the first-attempt clock down into a subflow", () => {
    const parent = new RunIdentity("run_a", [], 3, "2026-08-19T00:00:00Z");
    const child = parent.descend("billing");

    expect(child.attempt).toBe(3);
    expect(child.firstAttemptAt).toBe("2026-08-19T00:00:00Z");
  });

  it("does not let a slash in a node id impersonate a nesting level", () => {
    const flat = new RunIdentity("run_a").stepKey("a/b");
    const nested = new RunIdentity("run_a").descend("a").stepKey("b");

    expect(flat).not.toBe(nested);
    expect(flat).toBe("run_a:a%2Fb");
    expect(nested).toBe("run_a:a/b");
  });

  it("escapes the escape character first", () => {
    expect(new RunIdentity("run_a").stepKey("a%2Fb")).toBe("run_a:a%252Fb");
    expect(new RunIdentity("run_a").stepKey("a%2Fb")).not.toBe(
      new RunIdentity("run_a").stepKey("a/b"),
    );
  });

  it("is immutable — descend returns a new identity", () => {
    const parent = new RunIdentity("run_a");
    parent.descend("billing");
    expect(parent.path).toEqual([]);
  });

  it("round-trips through a queue payload", () => {
    const id = new RunIdentity("run_a", ["billing"], 4, "2026-08-19T00:00:00.000Z");
    expect(RunIdentity.from(JSON.parse(JSON.stringify(id))).stepKey("pay")).toBe(id.stepKey("pay"));
  });

  it("refuses an empty run key rather than minting a useless identity", () => {
    expect(() => new RunIdentity("  ")).toThrow(/non-empty/);
  });
});

describe("RunIdentity — the provider's dedup window", () => {
  const at = (iso: string) => new RunIdentity("run_a", [], 2, iso);

  it("is replay-safe on attempt 1 however long the run was parked", () => {
    const parked = new RunIdentity("run_a", [], 1, "2026-08-01T00:00:00Z");
    expect(parked.isReplaySafe(86400, "2026-08-19T00:00:00Z")).toBe(true);
  });

  it("is replay-safe for a retry inside the window, inclusive of its edge", () => {
    expect(at("2026-08-18T00:00:00Z").isReplaySafe(86400, "2026-08-19T00:00:00Z")).toBe(true);
  });

  it("is NOT replay-safe one second past the window", () => {
    expect(at("2026-08-18T00:00:00Z").isReplaySafe(86400, "2026-08-19T00:00:01Z")).toBe(false);
  });

  it("treats a zero window as a window, not as an absent one", () => {
    expect(at("2026-08-19T00:00:00Z").isReplaySafe(0, "2026-08-19T00:00:00Z")).toBe(false);
    expect(
      new RunIdentity("run_a", [], 1, "2026-08-19T00:00:00Z").isReplaySafe(
        0,
        "2026-08-19T00:00:00Z",
      ),
    ).toBe(true);
  });

  it("treats a null window as a provider that never forgets", () => {
    expect(at("2020-01-01T00:00:00Z").isReplaySafe(null, "2026-08-19T00:00:00Z")).toBe(true);
  });

  it("clamps clock skew to zero rather than refusing a legitimate retry", () => {
    expect(at("2026-08-19T00:00:10Z").isReplaySafe(86400, "2026-08-19T00:00:00Z")).toBe(true);
  });

  it("refuses to guess at an unparseable timestamp", () => {
    expect(() => at("not a date").isReplaySafe(86400, "2026-08-19T00:00:00Z")).toThrow(
      /parseable timestamp/,
    );
  });
});

describe("runFlow — the identity reaches the executor", () => {
  const graph: FlowGraph = { nodes: [node("a"), node("b")], edges: [edge("a", "b")] };

  it("gives every executor the run identity the host supplied", async () => {
    const seen: string[] = [];
    const executors: ExecutorRegistry = {
      "*": (ctx) => {
        seen.push(ctx.run!.stepKey(ctx.node.id));
        return { ok: true };
      },
    };

    await runFlow(graph, executors, () => {}, {
      run: new RunIdentity("run_a", [], 1, "2026-08-19T00:00:00Z"),
    });

    expect(seen).toEqual(["run_a:a", "run_a:b"]);
  });

  it("accepts a plain run key, so a host does not have to build the object", async () => {
    let key = "";
    await runFlow({ nodes: [node("a")], edges: [] }, { "*": (ctx) => (key = ctx.run!.stepKey("a")) }, () => {}, {
      run: "run_a",
    });

    expect(key).toBe("run_a:a");
  });

  it("leaves ctx.run undefined when the host supplied no identity", async () => {
    // Deliberately NOT auto-minted. A random key per call is a key that changes
    // on every whole-run retry, which is the failure mode this exists to stop —
    // so a host that has not thought about it gets an honest `undefined` and a
    // connector that declines to write blind.
    let run: unknown = "unset";
    await runFlow({ nodes: [node("a")], edges: [] }, { "*": (ctx) => (run = ctx.run) });

    expect(run).toBeUndefined();
  });
});

describe("runFlow — resumeOutputs", () => {
  const graph: FlowGraph = {
    nodes: [node("a"), node("b"), node("c")],
    edges: [edge("a", "b"), edge("b", "c")],
  };

  it("republishes a checkpointed node instead of re-running it", async () => {
    const ran: string[] = [];
    const executors: ExecutorRegistry = {
      "*": (ctx) => {
        ran.push(ctx.node.id);
        return { from: ctx.node.id };
      },
    };

    const result = await runFlow(graph, executors, () => {}, {
      resumeOutputs: { a: { from: "a" }, b: { from: "b" } },
    });

    expect(ran).toEqual(["c"]);
    expect(result.outputs.a).toEqual({ from: "a" });
    expect(result.ok).toBe(true);
  });

  it("routes downstream from a resumed node exactly as the first run did", async () => {
    const decide: FlowGraph = {
      nodes: [node("d", "branch"), node("yes"), node("no")],
      edges: [
        { id: "e1", source: "d", target: "yes", sourceHandle: "true" },
        { id: "e2", source: "d", target: "no", sourceHandle: "false" },
      ],
    };
    const ran: string[] = [];

    await runFlow(decide, { "*": (ctx) => ran.push(ctx.node.id) }, () => {}, {
      resumeOutputs: { d: { branch: "true", value: 1 } },
    });

    expect(ran).toEqual(["yes"]);
  });

  it("emits a resumed status so a run feed does not report the node as fresh", async () => {
    const texts: string[] = [];
    await runFlow(
      { nodes: [node("a")], edges: [] },
      { "*": () => ({}) },
      (e) => {
        if (e.type === "node-status" && e.text) texts.push(e.text);
      },
      { resumeOutputs: { a: { done: true } } },
    );

    expect(texts).toContain("resumed");
  });
});
