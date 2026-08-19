import { describe, expect, it } from "vitest";

import {
  Coordinator,
  Frontier,
  InMemoryClaimStore,
  NotAwaitingHuman,
  RetryPolicy,
  Submissions,
  durableApproval,
  durableUserInput,
  replayUpTo,
} from "../src/durable";
import { registerNodeKind } from "../src/registry";
import { runFlow } from "../src/runtime/run-flow";
import { RunIdentity } from "../src/runtime/run-identity";
import type { ExecutorRegistry, FlowGraph } from "../src/types";

const node = (id: string, type = "action", config?: Record<string, unknown>) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data: config ? { config } : {},
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}-${target}-${sourceHandle ?? "out"}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});

const linear: FlowGraph = {
  nodes: [node("a"), node("b"), node("c")],
  edges: [edge("a", "b"), edge("b", "c")],
};

const decision: FlowGraph = {
  nodes: [node("start"), node("d", "branch"), node("yes"), node("no"), node("join"), node("out")],
  edges: [
    edge("start", "d"),
    edge("d", "yes", "true"),
    edge("d", "no", "false"),
    edge("yes", "join"),
    edge("no", "join"),
    edge("join", "out"),
  ],
};

const fanout: FlowGraph = {
  nodes: [node("t"), node("p1"), node("p2"), node("m")],
  edges: [edge("t", "p1"), edge("t", "p2"), edge("p1", "m"), edge("p2", "m")],
};

const echo: ExecutorRegistry = {
  branch: () => ({ branch: "true", value: { took: "true" } }),
  "*": (ctx) => ({ ran: ctx.node.id, inputs: ctx.inputs }),
};

describe("Coordinator — the two operations", () => {
  it("dispatches only the entry point, then unblocks one node at a time", async () => {
    const runner = new Coordinator({ graph: linear, executors: echo, run: "run_a" });

    expect(await runner.advance()).toEqual(["a"]);
    await runner.runNode("a");
    expect(await runner.advance()).toEqual(["b"]);
    await runner.runNode("b");
    expect(await runner.advance()).toEqual(["c"]);
    await runner.runNode("c");
    expect(await runner.advance()).toEqual([]);
  });

  it("executes each node exactly once even when two workers race for it", async () => {
    let ran = 0;
    const runner = new Coordinator({
      graph: linear,
      executors: { "*": () => ({ n: ++ran }) },
      run: "run_a",
    });

    const [first, second] = await Promise.all([runner.runNode("a", "w1"), runner.runNode("a", "w2")]);

    expect(ran).toBe(1);
    expect([first.claimed, second.claimed].filter(Boolean)).toHaveLength(1);
    expect([first.status, second.status]).toContain("not-claimed");
  });

  it("lets a job's own retry re-enter its claim rather than deadlock on itself", async () => {
    const runner = new Coordinator({
      graph: linear,
      executors: { "*": () => ({}) },
      run: "run_a",
    });

    expect((await runner.runNode("a", "same-token")).claimed).toBe(true);
    // Settled: even our own token must not re-run a completed node.
    expect((await runner.runNode("a", "same-token")).claimed).toBe(false);
  });

  it("dispatches both live branches of a fan-out, and the join only after both", async () => {
    const runner = new Coordinator({ graph: fanout, executors: echo, run: "run_a" });

    await runner.runNode("t");
    expect((await runner.advance()).sort()).toEqual(["p1", "p2"]);

    await runner.runNode("p1");
    // m is NOT ready — p2 has settled nothing yet. p2 is still on the frontier
    // because it was dispatched-but-unclaimed, which is exactly right.
    expect(await runner.advance()).not.toContain("m");

    await runner.runNode("p2");
    expect(await runner.advance()).toEqual(["m"]);
  });

  it("collapses a dead branch by cascade rather than stalling on it", async () => {
    const runner = new Coordinator({ graph: decision, executors: echo, run: "run_a" });

    await runner.runNode("start");
    await runner.runNode("d");

    // `no` was reached down a dead edge: the frontier settles it as skipped,
    // and `join` still runs on the strength of the one live edge.
    expect(await runner.advance()).toEqual(["yes"]);
    await runner.runNode("yes");
    expect(await runner.advance()).toEqual(["join"]);
  });

  it("refuses to be constructed without a run identity", () => {
    expect(() => new Coordinator({ graph: linear, executors: echo, run: "" })).toThrow(/non-empty/);
  });
});

describe("Coordinator — parity with the single-process engine", () => {
  it.each([
    ["linear", linear],
    ["decision + merge", decision],
    ["parallel fan-out", fanout],
  ])("reaches the same outputs as runFlow for %s", async (_name, graph) => {
    const single = await runFlow(graph, echo);
    const durable = await new Coordinator({ graph, executors: echo, run: "run_a" }).runToCompletion();

    expect(durable.ok).toBe(single.ok);
    expect(durable.outputs).toEqual(single.outputs);
  });

  it("does not re-execute a checkpointed node when the run resumes", async () => {
    const ran: string[] = [];
    const executors: ExecutorRegistry = {
      "*": (ctx) => {
        ran.push(ctx.node.id);
        return { ran: ctx.node.id };
      },
    };
    const store = new InMemoryClaimStore();

    const first = new Coordinator({ graph: linear, executors, run: "run_a", store });
    await first.runNode("a");
    await first.runNode("b");
    ran.length = 0;

    // A worker was killed here. A fresh Coordinator over the SAME store is what
    // the next job is.
    const resumed = new Coordinator({ graph: linear, executors, run: "run_a", store });
    await resumed.runToCompletion();

    expect(ran).toEqual(["c"]);
  });
});

describe("Coordinator — a human gate holds no worker", () => {
  const gated: FlowGraph = {
    nodes: [node("start"), node("ask", "user_input"), node("after")],
    edges: [edge("start", "ask"), edge("ask", "after")],
  };

  it("parks the run and RETURNS, without running anything downstream", async () => {
    const submissions = new Submissions();
    const store = new InMemoryClaimStore();
    const ran: string[] = [];
    const executors: ExecutorRegistry = {
      user_input: durableUserInput(submissions),
      "*": (ctx) => {
        ran.push(ctx.node.id);
        return { ran: ctx.node.id };
      },
    };

    const outcome = await new Coordinator({
      graph: gated,
      executors,
      run: "run_a",
      store,
    }).runToCompletion();

    expect(outcome.paused).toBe(true);
    expect(outcome.pause?.nodeId).toBe("ask");
    expect(ran).toEqual(["start"]);
    // The parked node holds a claim; nothing downstream was dispatched, and the
    // call returned rather than waiting.
    expect(store.state("run_a").ask!.status).toBe("paused");
    expect(store.state("run_a").after).toBeUndefined();
  });

  it("advances no further while parked — a second advance dispatches nothing", async () => {
    const submissions = new Submissions();
    const store = new InMemoryClaimStore();
    const runner = new Coordinator({
      graph: gated,
      executors: { user_input: durableUserInput(submissions), "*": () => ({}) },
      run: "run_a",
      store,
    });

    await runner.runToCompletion();
    expect(await runner.advance()).toEqual([]);
    expect(Frontier.hasWorkInFlight(store.state("run_a"))).toBe(true);
  });

  it("resumes from the recorded answer, and only then runs the rest", async () => {
    const submissions = new Submissions();
    const store = new InMemoryClaimStore();
    const executors: ExecutorRegistry = {
      user_input: durableUserInput(submissions),
      "*": (ctx) => ({ ran: ctx.node.id, saw: ctx.inputs }),
    };

    const first = new Coordinator({ graph: gated, executors, run: "run_a", store });
    await first.runToCompletion();

    // What a host does when the person answers: record, release the claim, and
    // advance. THAT is what enqueues the continuation.
    submissions.record("ask", { email: "ada@example.com" });
    store.release("run_a", "ask");

    const resumed = await new Coordinator({
      graph: gated,
      executors,
      run: "run_a",
      store,
    }).runToCompletion();

    expect(resumed.ok).toBe(true);
    expect(resumed.outputs.ask).toEqual({ email: "ada@example.com" });
    expect(resumed.outputs.after).toBeDefined();
  });

  it("does NOT let a pre-filled input satisfy the gate", async () => {
    const submissions = new Submissions();
    const outcome = await new Coordinator({
      graph: { nodes: [node("ask", "user_input")], edges: [] },
      executors: { user_input: durableUserInput(submissions) },
      run: "run_a",
      initialInputs: { ask: { values: { email: "sneaky@example.com" } } },
    }).runToCompletion();

    expect(outcome.paused).toBe(true);
  });

  it("honours autoAnswerFromInput when a node opts in explicitly", async () => {
    const submissions = new Submissions();
    const outcome = await new Coordinator({
      graph: { nodes: [node("ask", "user_input", { autoAnswerFromInput: true })], edges: [] },
      executors: { user_input: durableUserInput(submissions) },
      run: "run_a",
      initialInputs: { ask: { values: { email: "ada@example.com" } } },
    }).runToCompletion();

    expect(outcome.paused).toBe(false);
    expect(outcome.outputs.ask).toEqual({ email: "ada@example.com" });
  });

  it("refuses an answer for a node the run is not parked on", () => {
    const submissions = new Submissions();
    expect(() => submissions.record("ask", {})).toThrow(NotAwaitingHuman);

    submissions.park("ask");
    expect(() => submissions.record("other", {})).toThrow(NotAwaitingHuman);
  });

  it("routes an approval down the branch the person chose", async () => {
    const submissions = new Submissions();
    const store = new InMemoryClaimStore();
    const graph: FlowGraph = {
      nodes: [node("gate", "human_approval"), node("ok"), node("nope")],
      edges: [edge("gate", "ok", "approved"), edge("gate", "nope", "denied")],
    };
    const executors: ExecutorRegistry = {
      human_approval: durableApproval(submissions),
      "*": (ctx) => ({ ran: ctx.node.id }),
    };

    await new Coordinator({ graph, executors, run: "run_a", store }).runToCompletion();
    submissions.record("gate", false);
    store.release("run_a", "gate");
    const resumed = await new Coordinator({ graph, executors, run: "run_a", store }).runToCompletion();

    expect(resumed.outputs.nope).toEqual({ ran: "nope" });
    expect(resumed.outputs.ok).toBeUndefined();
  });
});

describe("Coordinator — run identity per step", () => {
  it("hands each node a key that is stable across retries of that node", async () => {
    const keys: string[] = [];
    let fail = true;
    const executors: ExecutorRegistry = {
      "*": (ctx) => {
        keys.push(ctx.run!.stepKey(ctx.node.id));
        if (fail) {
          fail = false;
          throw new Error("transient");
        }
        return { ok: true };
      },
    };

    const outcome = await new Coordinator({
      graph: { nodes: [node("pay")], edges: [] },
      executors,
      run: "run_a",
      retry: new RetryPolicy({ tries: 3 }),
    }).runToCompletion();

    expect(outcome.ok).toBe(true);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("counts the attempt, so a caller can tell a retry from a first try", async () => {
    const attempts: number[] = [];
    let fail = true;
    const executors: ExecutorRegistry = {
      "*": (ctx) => {
        attempts.push(ctx.run!.attempt);
        if (fail) {
          fail = false;
          throw new Error("transient");
        }
        return {};
      },
    };

    await new Coordinator({
      graph: { nodes: [node("pay")], edges: [] },
      executors,
      run: "run_a",
      retry: new RetryPolicy({ tries: 3 }),
    }).runToCompletion();

    expect(attempts).toEqual([1, 2]);
  });

  it("gives two nodes of one run different keys", async () => {
    const keys: string[] = [];
    await new Coordinator({
      graph: linear,
      executors: { "*": (ctx) => keys.push(ctx.run!.stepKey(ctx.node.id)) },
      run: "run_a",
    }).runToCompletion();

    expect(new Set(keys).size).toBe(3);
  });
});

describe("RetryPolicy", () => {
  it("pins an unsafe-to-replay node to one attempt whatever tries says", async () => {
    // The shape a marketplace node like `git_pr_open` declares: retrying it
    // repeats the effect rather than recovering from it — a second pull
    // request, a second charge.
    const unregister = registerNodeKind({
      name: "test/unsafe_write",
      category: "io",
      label: "Unsafe write",
      sideEffects: "unsafe-to-replay",
      outputs: [{ id: "out" }],
    });
    let ran = 0;
    const outcome = await new Coordinator({
      graph: { nodes: [node("push", "test/unsafe_write")], edges: [] },
      executors: {
        "*": () => {
          ran++;
          throw new Error("boom");
        },
      },
      run: "run_a",
      retry: new RetryPolicy({ tries: 5 }),
    }).runToCompletion();

    expect(outcome.ok).toBe(false);
    expect(ran).toBe(1);
    unregister();
  });

  it("retries an ordinary node up to the configured tries", async () => {
    let ran = 0;
    await new Coordinator({
      graph: { nodes: [node("flaky")], edges: [] },
      executors: {
        "*": () => {
          ran++;
          throw new Error("boom");
        },
      },
      run: "run_a",
      retry: new RetryPolicy({ tries: 3 }),
    }).runToCompletion();

    expect(ran).toBe(3);
  });
});

describe("replayUpTo", () => {
  it("runs the target and nothing after it", async () => {
    const ran: string[] = [];
    const replay = await replayUpTo(linear, "a", { "*": (ctx) => ran.push(ctx.node.id) });

    expect(ran).toEqual(["a"]);
    expect(replay.portsOf("a")).toEqual(["out"]);
  });

  it("republishes the completed prefix without executing it", async () => {
    const ran: string[] = [];
    const replay = await replayUpTo(linear, "c", { "*": (ctx) => ran.push(ctx.node.id) }, {
      resumeOutputs: { a: { from: "a" }, b: { from: "b" } },
    });

    expect(ran).toEqual(["c"]);
    expect(replay.outputOf("c")).toBeDefined();
  });

  it("reports a boundary rather than a failure when it cannot reach the target", async () => {
    const replay = await replayUpTo(linear, "c", { "*": () => ({}) });
    expect(replay.result.ok).toBe(false);
    expect(replay.result.error).toBe("fancy-flow:node-boundary");
  });
});

describe("RunIdentity in a durable run", () => {
  it("reports the first-attempt clock from the claim row, not from the run", async () => {
    let seen: RunIdentity | undefined;
    await new Coordinator({
      graph: { nodes: [node("a")], edges: [] },
      executors: { "*": (ctx) => ((seen = ctx.run), {}) },
      run: new RunIdentity("run_a", [], 1, "2020-01-01T00:00:00.000Z"),
    }).runToCompletion();

    // The run object was minted with an ancient clock; the STEP's clock is when
    // the node was first claimed, which is what the window check must use.
    expect(seen!.firstAttemptAt).not.toBe("2020-01-01T00:00:00.000Z");
    expect(seen!.isReplaySafe(86400)).toBe(true);
  });
});
