/**
 * What a durable replay fences off, and what the fence must NOT do.
 *
 * `Coordinator.runNode` runs one node by replaying the graph through `runFlow`,
 * with every other node bound to a fence. Three defects lived in that fence, and
 * all three reported success:
 *
 * 1. **The fence aborted the walk.** Two siblings dispatched together have no
 *    order on real workers. When `b`'s job ran while `a` was still running,
 *    `b`'s replay reached the unfinished `a` first in topological order and
 *    aborted there. The coordinator read "the replay ended without running me"
 *    as "unreachable": `b` was recorded SKIPPED, never ran, and the run completed
 *    as a success. Every existing test ran nodes in the order the engine walks
 *    them, so none produced it -- but one worker could, whenever the graph's
 *    node order and edge order disagree about siblings. The PHP twin had the
 *    same design and the same bug (fixed in fancy-flow-php 0.53.1).
 *
 * 2. **The fence was bound in the KIND namespace.** A registry is one flat
 *    object, so `fenced["host_kind"]` fenced the node whose id is `host_kind`
 *    AND every node whose kind is `host_kind`. A durable run of such a graph ran
 *    nothing and reported `{ ok: true, outputs: {} }`.
 *
 * 3. **The fence leaked into subflows.** `ctx.executors` handed the fenced
 *    registry to a `subflow` child, so a child node sharing an id with any
 *    parent node ran the fence instead of its executor.
 *
 * Every test here holds the durable path to what `runFlow` does with the same
 * graph and the same executors.
 */
import { afterEach, describe, expect, it } from "vitest";

import { Coordinator, UNLIMITED_CONCURRENCY, replayUpTo } from "../src/durable";
import { registerWorkflowResolver } from "../src/registry/capabilities";
import { subflowExecutor } from "../src/registry/subflow";
import { runFlow } from "../src/runtime/run-flow";
import type { ExecutorRegistry, FlowGraph } from "../src/types";

const node = (id: string, type = "action", data: Record<string, unknown> = {}) => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data,
});
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });

/** An executor registry that records every node it actually executes. */
function recording(): { ran: string[]; executors: ExecutorRegistry } {
  const ran: string[] = [];
  return {
    ran,
    executors: {
      "*": (ctx) => {
        ran.push(ctx.node.id);
        return { ran: ctx.node.id, inputs: ctx.inputs };
      },
    },
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("sibling jobs out of order", () => {
  const siblings: FlowGraph = {
    nodes: [node("t"), node("a"), node("b")],
    edges: [edge("t", "a"), edge("t", "b")],
  };

  it("runs b when b's job runs before a's, instead of skipping it", async () => {
    const { ran, executors } = recording();
    // Parallel on purpose: siblings dispatched together is the condition this
    // bug needed, and the serial default never hands out two at once.
    const runner = new Coordinator({
      graph: siblings,
      executors,
      run: "run_siblings",
      maxConcurrent: UNLIMITED_CONCURRENCY,
    });

    await runner.runNode("t");
    // Dispatched together. Nothing orders the two jobs.
    expect((await runner.advance()).sort()).toEqual(["a", "b"]);

    const b = await runner.runNode("b");

    expect(b.status).toBe("completed");
    expect(ran).toEqual(["t", "b"]);

    // The rest drains normally, and every node ran exactly once.
    const result = await runner.runToCompletion();
    const single = await runFlow(siblings, recording().executors);

    expect(result.ok).toBe(true);
    expect(ran).toEqual(["t", "b", "a"]);
    expect(result.outputs).toEqual(single.outputs);
  });

  it("runs b while a is still EXECUTING on another worker", async () => {
    // The literal race: `a` is claimed and inside its executor when `b`'s job
    // starts. `a`'s row is CLAIMED, not completed, so `b`'s replay cannot
    // resume it and must walk past it.
    const ran: string[] = [];
    const aStarted = deferred();
    const releaseA = deferred();
    const executors: ExecutorRegistry = {
      "*": async (ctx) => {
        ran.push(ctx.node.id);
        if (ctx.node.id === "a") {
          aStarted.resolve();
          await releaseA.promise;
        }
        return { ran: ctx.node.id, inputs: ctx.inputs };
      },
    };
    // Parallel on purpose: two siblings in flight at once only happens when the
    // host opts out of the serial default.
    const runner = new Coordinator({
      graph: siblings,
      executors,
      run: "run_in_flight",
      maxConcurrent: UNLIMITED_CONCURRENCY,
    });

    await runner.runNode("t");
    const aJob = runner.runNode("a", "worker-a");
    await aStarted.promise;
    expect((await runner.store.state(runner.runKey)).a?.status).toBe("claimed");

    const b = await runner.runNode("b", "worker-b");

    expect(b.status).toBe("completed");
    expect(b.output).toEqual({ ran: "b", inputs: { in: { ran: "t", inputs: {} }, t: { ran: "t", inputs: {} } } });

    releaseA.resolve();
    expect((await aJob).status).toBe("completed");

    const result = await runner.runToCompletion();
    expect(result.ok).toBe(true);
    expect(ran).toEqual(["t", "a", "b"]);
    expect(Object.keys(result.outputs)).toEqual(["t", "a", "b"]);
  });

  it("runToCompletion runs every sibling when node order and edge order disagree", async () => {
    // No second worker needed. The frontier lists ready nodes in NODE order
    // (`b`, `a`) and the engine walks EDGE order (`t`, `a`, `b`), so the
    // in-process driver runs `b` first and `b`'s replay meets the unrun `a`.
    const reordered: FlowGraph = {
      nodes: [node("t"), node("b"), node("a")],
      edges: [edge("t", "a"), edge("t", "b")],
    };
    const { ran, executors } = recording();

    const result = await new Coordinator({ graph: reordered, executors, run: "run_reordered" }).runToCompletion();
    const single = await runFlow(reordered, recording().executors);

    expect({ ok: result.ok, outputs: result.outputs }).toEqual({ ok: true, outputs: single.outputs });
    expect([...ran].sort()).toEqual(["a", "b", "t"]);
  });

  it("still records a node the engine finds unreachable as skipped, not failed", async () => {
    // The other half of the fix. A replay that walks past fences and finishes
    // without the target's output means the engine found every inbound edge
    // dead. That is a skip. Treating "no output, no error" as a failure would
    // settle the node FAILED and fail the run.
    const decision: FlowGraph = {
      nodes: [node("start"), node("d", "branch"), node("yes"), node("no")],
      edges: [
        edge("start", "d"),
        { id: "d-yes", source: "d", target: "yes", sourceHandle: "true" },
        { id: "d-no", source: "d", target: "no", sourceHandle: "false" },
      ],
    };
    const runner = new Coordinator({
      graph: decision,
      executors: { branch: () => ({ branch: "true", value: 1 }), "*": () => ({}) },
      run: "run_dead_branch",
    });

    await runner.runNode("start");
    await runner.runNode("d");
    const no = await runner.runNode("no");

    expect(no.status).toBe("skipped");
    expect((await runner.store.state(runner.runKey)).no?.status).toBe("skipped");
  });

  it("gives the replay result no output for a fenced node", async () => {
    // A fence executes nothing, so nothing it did is an output.
    const { ran, executors } = recording();
    const replay = await replayUpTo(siblings, "b", executors, { resumeOutputs: { t: { ran: "t" } } });

    expect(ran).toEqual(["b"]);
    expect(Object.keys(replay.result.outputs).sort()).toEqual(["b", "t"]);
    expect(replay.outputOf("a")).toBeUndefined();
    expect(replay.portsOf("a")).toEqual([]);
  });
});

describe("a node whose id is also a kind id", () => {
  // Every node is a `host_kind`, and the middle one is also CALLED `host_kind`.
  const graph: FlowGraph = {
    nodes: [node("first", "host_kind"), node("host_kind", "host_kind"), node("last", "host_kind")],
    edges: [edge("first", "host_kind"), edge("host_kind", "last")],
  };

  const hostRegistry = (ran: string[]): ExecutorRegistry => ({
    host_kind: (ctx) => {
      ran.push(ctx.node.id);
      return { ran: ctx.node.id };
    },
  });

  it("CONTROL: runFlow runs all three nodes", async () => {
    const ran: string[] = [];
    const result = await runFlow(graph, hostRegistry(ran));

    expect(result.ok).toBe(true);
    expect(ran).toEqual(["first", "host_kind", "last"]);
  });

  it("the durable run executes the same nodes as runFlow", async () => {
    const ran: string[] = [];
    const single = await runFlow(graph, hostRegistry([]));
    const durable = await new Coordinator({
      graph,
      executors: hostRegistry(ran),
      run: "run_id_is_a_kind",
    }).runToCompletion();

    // The run used to report `{ ok: true, outputs: {} }` here: success, with
    // nothing run.
    expect({ ok: durable.ok, outputs: durable.outputs }).toEqual({ ok: true, outputs: single.outputs });
    expect(ran).toEqual(["first", "host_kind", "last"]);
  });

  it("a node-id binding matches only that node id, never a kind", async () => {
    // The resolution rule the fence needs, asked of `runFlow` directly.
    const ran: string[] = [];
    await runFlow(graph, hostRegistry(ran), () => {}, {
      nodeExecutors: {
        host_kind: () => {
          ran.push("pinned");
          return {};
        },
      },
    });

    expect(ran).toEqual(["first", "pinned", "last"]);
  });

  it("a node-id binding outranks a host binding on the same node id", async () => {
    const ran: string[] = [];
    await runFlow(
      { nodes: [node("n1", "llm_call")], edges: [] },
      { n1: () => ran.push("host by id"), llm_call: () => ran.push("host by kind") },
      () => {},
      { nodeExecutors: { n1: () => ran.push("node binding") } },
    );

    expect(ran).toEqual(["node binding"]);
  });
});

describe("a subflow inside a durable run", () => {
  const teardown: Array<() => void> = [];
  afterEach(() => {
    while (teardown.length) teardown.pop()!();
  });

  // The child's only node is called `t` -- the same id as the parent's trigger.
  const child: FlowGraph = { nodes: [node("t", "host_kind")], edges: [] };
  const parent: FlowGraph = {
    nodes: [node("t", "host_kind"), node("sub", "subflow", { config: { workflow: "child" } })],
    edges: [edge("t", "sub")],
  };

  const executors = (calls: string[]): ExecutorRegistry => ({
    subflow: subflowExecutor,
    host_kind: (ctx) => {
      calls.push(`depth ${ctx.depth ?? 0}: ${ctx.node.id}`);
      return { at: ctx.depth ?? 0 };
    },
  });

  it("runs the child with the real executors, not the parent's fences", async () => {
    teardown.push(registerWorkflowResolver((ref: string) => (ref === "child" ? (child as never) : null)));

    const singleCalls: string[] = [];
    const single = await runFlow(parent, executors(singleCalls));
    expect(single.ok).toBe(true);

    const calls: string[] = [];
    const durable = await new Coordinator({
      graph: parent,
      executors: executors(calls),
      run: "run_subflow",
    }).runToCompletion();

    expect(durable.error).toBeUndefined();
    expect(durable.ok).toBe(true);
    expect(calls).toEqual(singleCalls);
    expect(calls).toEqual(["depth 0: t", "depth 1: t"]);
    expect(durable.outputs).toEqual(single.outputs);
  });
});
