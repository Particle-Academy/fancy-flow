import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerTerminalHost, type TerminalHost, type TerminalSession } from "../src/registry/capabilities";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph, FlowNode, NodeExecutor } from "../src/types";

/**
 * Terminal lane lifetime.
 *
 * The feature is three promises and they are all about WHEN, not what:
 *
 *   1. one terminal per lane, however many nodes use it;
 *   2. it opens at the first terminal node, not when the run starts;
 *   3. it stays open until the run finishes — including when the run fails.
 *
 * Each is asserted against a fake host that COUNTS, because every one of them
 * fails silently in production: two shells look like one that forgot a `cd`, an
 * eager open looks like a slow start, and a leaked PTY looks like nothing at
 * all until the machine is full of them.
 */

let opened: Array<{ spec: unknown; session: TerminalSession }> = [];

function countingHost(): TerminalHost {
  return {
    open: (spec) => {
      const session: TerminalSession = {
        id: `s${opened.length + 1}`,
        write: vi.fn(),
        onData: () => () => {},
        exited: new Promise(() => {}),
        close: vi.fn(),
      };
      opened.push({ spec, session });
      return session;
    },
  };
}

function node(id: string, type: string, extra: Record<string, unknown> = {}): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id }, ...extra } as unknown as FlowNode;
}

/** A lane with two nodes inside it, wired in sequence. */
function graphWithLane(): FlowGraph {
  return {
    nodes: [
      node("lane", "@particle-academy/terminal_lane", {
        data: { label: "lane", config: { command: "bash", cwd: "/tmp" } },
      }),
      node("a", "probe", { parentId: "lane" }),
      node("b", "probe", { parentId: "lane" }),
      node("outside", "probe"),
    ],
    edges: [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "outside" },
    ],
  } as unknown as FlowGraph;
}

/** An executor that opens its terminal only when the node id is in `touch`. */
function probeExecutor(touch: string[]): NodeExecutor {
  return async (ctx) => {
    if (!touch.includes(ctx.node.id)) return { touched: false };
    if (!ctx.terminal) return { terminal: null };
    const session = await ctx.terminal.session();
    return { sessionId: session.id };
  };
}

beforeEach(() => {
  opened = [];
  registerBuiltinKinds();
});

describe("terminal lane", () => {
  test("gives every node in the lane the SAME session", async () => {
    const restore = registerTerminalHost(countingHost());

    const result = await runFlow(graphWithLane(), { probe: probeExecutor(["a", "b"]) });

    expect(result.ok).toBe(true);
    // The assertion that matters. Two sessions here would still LOOK correct at
    // every individual node — it is the shared state between them that breaks.
    expect(opened).toHaveLength(1);
    expect((result.outputs.a as { sessionId: string }).sessionId)
      .toBe((result.outputs.b as { sessionId: string }).sessionId);

    restore();
  });

  test("opens nothing until a node actually uses it", async () => {
    const restore = registerTerminalHost(countingHost());

    // Both nodes are inside the lane; neither touches the terminal.
    await runFlow(graphWithLane(), { probe: probeExecutor([]) });

    expect(opened).toHaveLength(0);

    restore();
  });

  test("passes the lane's own command and cwd to the host", async () => {
    const restore = registerTerminalHost(countingHost());

    await runFlow(graphWithLane(), { probe: probeExecutor(["a"]) });

    expect(opened[0]?.spec).toMatchObject({ command: "bash", cwd: "/tmp" });

    restore();
  });

  test("closes the session when the run ends", async () => {
    const restore = registerTerminalHost(countingHost());

    await runFlow(graphWithLane(), { probe: probeExecutor(["a"]) });

    expect(opened[0]?.session.close).toHaveBeenCalledTimes(1);

    restore();
  });

  test("closes the session even when the run FAILS", async () => {
    // The path that leaks. A run that ends tidily is the easy case; a PTY
    // surviving a failed run is a process nobody is watching and nothing will
    // close, and it is invisible until there are a hundred of them.
    const restore = registerTerminalHost(countingHost());

    const explode: NodeExecutor = async (ctx) => {
      if (ctx.node.id === "a") {
        await ctx.terminal!.session();
        return { ok: true };
      }
      throw new Error("boom");
    };

    const result = await runFlow(graphWithLane(), { probe: explode });

    expect(result.ok).toBe(false);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.session.close).toHaveBeenCalledTimes(1);

    restore();
  });

  test("a node outside any terminal lane gets no terminal at all", async () => {
    // `undefined` is a real answer, not a missing one: a terminal node outside
    // a lane must say so rather than quietly opening a shell of its own.
    const restore = registerTerminalHost(countingHost());

    const result = await runFlow(graphWithLane(), { probe: probeExecutor(["outside"]) });

    expect((result.outputs.outside as { terminal: null }).terminal).toBeNull();
    expect(opened).toHaveLength(0);

    restore();
  });

  test("names a MISSING HOST rather than reporting a failed terminal", async () => {
    // No host registered at all. This is a configuration problem — the desktop
    // app installed none — and calling it "the terminal failed" sends someone
    // to debug a process that was never started.
    const result = await runFlow(graphWithLane(), { probe: probeExecutor(["a"]) });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No terminal host is registered");
  });
});
