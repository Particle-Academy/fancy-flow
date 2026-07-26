import { describe, expect, it } from "vitest";
import { runCohort } from "../src/runtime/run-cohort";
import type { ExecutorRegistry, FlowGraph } from "../src/types";

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as FlowGraph["nodes"][number];
const edge = (id: string, source: string, target: string) =>
  ({ id, source, target }) as FlowGraph["edges"][number];

/** A one-node flow tagged so we can see the order it ran in. */
const tagged = (tag: string): FlowGraph => ({
  nodes: [node("t", "trigger"), node("x", "action", { tag })],
  edges: [edge("e1", "t", "x")],
});

describe("runCohort — trigger collision", () => {
  // The hazard: one event fires several flows, one of them removes the record
  // they were all fired for, and the rest run over nothing and report ok:true.
  // Nothing throws, so nothing surfaces it. These pin the ordering + guard that
  // make that outcome impossible.

  it("runs the flows in declared order, not whatever resolves first", async () => {
    const log: string[] = [];
    const executors: ExecutorRegistry = {
      "*": async ({ node }) => {
        // Later flows deliberately finish faster — a Promise.all would
        // interleave them and the order would be a lie.
        const tag = node.data?.tag as string | undefined;
        if (tag) {
          await new Promise((r) => setTimeout(r, tag === "a" ? 20 : 0));
          log.push(tag);
        }
        return { ran: node.id };
      },
    };

    await runCohort([tagged("a"), tagged("b"), tagged("c")], executors);

    expect(log).toEqual(["a", "b", "c"]);
  });

  it("skips a flow whose guard no longer passes, and says why", async () => {
    const log: string[] = [];
    let dealExists = true;
    const executors: ExecutorRegistry = {
      "*": ({ node }) => {
        const tag = node.data?.tag as string | undefined;
        if (tag === "archive") dealExists = false; // the collision, in one line
        if (tag) log.push(tag);
        return { ran: node.id };
      },
    };

    const results = await runCohort([tagged("archive"), tagged("notify")], executors, undefined, {
      guard: () => dealExists,
      reason: () => "deal 41 no longer exists",
    });

    expect(log).toEqual(["archive"]);
    expect(results[1].skipped).toBe(true);
    expect(results[1].skippedReason).toBe("deal 41 no longer exists");
    expect(results[1].ok).toBe(false);
  });

  it("runs everything when the guard keeps passing", async () => {
    const log: string[] = [];
    const executors: ExecutorRegistry = {
      "*": ({ node }) => {
        const tag = node.data?.tag as string | undefined;
        if (tag) log.push(tag);
        return { ran: node.id };
      },
    };

    const results = await runCohort([tagged("a"), tagged("b")], executors, undefined, {
      guard: () => true,
    });

    expect(log).toEqual(["a", "b"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.some((r) => r.skipped)).toBe(false);
  });

  it("fails closed when the guard itself throws", async () => {
    const log: string[] = [];
    const executors: ExecutorRegistry = {
      "*": ({ node }) => {
        const tag = node.data?.tag as string | undefined;
        if (tag) log.push(tag);
        return {};
      },
    };

    const results = await runCohort([tagged("a")], executors, undefined, {
      guard: () => {
        throw new Error("the guard is broken");
      },
    });

    // A guard that cannot answer is not permission to proceed.
    expect(log).toEqual([]);
    expect(results[0].skipped).toBe(true);
    expect(results[0].skippedReason).toContain("the guard is broken");
  });

  it("keeps going after a flow fails — failure is not an answer about state", async () => {
    const log: string[] = [];
    const executors: ExecutorRegistry = {
      "*": ({ node }) => {
        const tag = node.data?.tag as string | undefined;
        if (tag === "boom") throw new Error("boom");
        if (tag) log.push(tag);
        return {};
      },
    };

    const results = await runCohort([tagged("boom"), tagged("after")], executors, undefined, {
      guard: () => true,
    });

    expect(results[0].ok).toBe(false);
    expect(log).toEqual(["after"]);
  });

  it("ignores the guard under the serial policy — the old, unguarded behaviour", async () => {
    const log: string[] = [];
    const executors: ExecutorRegistry = {
      "*": ({ node }) => {
        const tag = node.data?.tag as string | undefined;
        if (tag) log.push(tag);
        return {};
      },
    };

    await runCohort([tagged("a")], executors, undefined, {
      policy: "serial",
      guard: () => false,
    });

    expect(log).toEqual(["a"]);
  });

  it("runs everything concurrently under the parallel policy", async () => {
    const started: string[] = [];
    const executors: ExecutorRegistry = {
      "*": async ({ node }) => {
        const tag = node.data?.tag as string | undefined;
        if (tag) {
          started.push(tag);
          await new Promise((r) => setTimeout(r, tag === "a" ? 20 : 0));
        }
        return {};
      },
    };

    const results = await runCohort([tagged("a"), tagged("b")], executors, undefined, {
      policy: "parallel",
    });

    expect(started).toEqual(["a", "b"]); // both entered before either finished
    expect(results.map((r) => r.index)).toEqual([0, 1]);
  });

  it("tags each event with the flow it came from", async () => {
    const seen: Array<[string, number]> = [];
    const executors: ExecutorRegistry = { "*": () => ({}) };

    await runCohort([tagged("a"), tagged("b")], executors, (event, index) => {
      if (event.type === "node-status" && event.status === "done") {
        seen.push([event.nodeId as string, index]);
      }
    });

    // Otherwise a host feeding a status panel cannot tell two flows apart —
    // both graphs legitimately use the same node ids.
    expect(seen).toEqual([
      ["t", 0],
      ["x", 0],
      ["t", 1],
      ["x", 1],
    ]);
  });
});
