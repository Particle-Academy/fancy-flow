import { describe, expect, it } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import type { ExecutorRegistry, FlowGraph } from "../src/types";

/**
 * A node can activate a CHOSEN SUBSET of its ports (fancy-flow-php#18, MOIC).
 *
 * The engine understood two shapes: `{ __port }` / `{ branch }` lit exactly one
 * port, and anything else lit EVERY declared port. There was no way to say "these
 * two of five". A triage node that routes an item to each queue it qualifies for,
 * or a dispatcher notifying every subscriber whose filter passed, could only wake
 * one lane (silently dropping the rest of the work) or wake all of them (doing
 * work nobody asked for).
 *
 * `{ __ports: [...] }` lights a list; `{ __ports: { port: value } }` gives each
 * lit port its own payload. An explicitly empty list lights nothing, which is the
 * rule an explicitly empty `outputs` array already follows.
 */

const node = (id: string, type: string, data: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as FlowGraph["nodes"][number];
const edge = (id: string, source: string, target: string, sourceHandle?: string) =>
  ({ id, source, target, sourceHandle }) as FlowGraph["edges"][number];

/** A router with five ports, and one collector per port. */
function graphOf(): FlowGraph {
  return {
    nodes: [
      node("r", "router", { outputs: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }] }),
      node("A", "sink"),
      node("B", "sink"),
      node("C", "sink"),
    ],
    edges: [edge("e1", "r", "A", "a"), edge("e2", "r", "B", "b"), edge("e3", "r", "C", "c")],
  };
}

const sinks = (seen: Record<string, unknown>): ExecutorRegistry => ({
  sink: async ({ node: n, inputs }) => {
    // `in` may legitimately BE null, so read presence, never `??` -- the very
    // confusion these rows are about.
    const value = Object.prototype.hasOwnProperty.call(inputs, "in") ? inputs.in : inputs;
    seen[n.id] = value;
    return value;
  },
});

describe("a node activates a chosen subset of its ports", () => {
  it("lights the listed ports and leaves the rest dark", async () => {
    const seen: Record<string, unknown> = {};
    const result = await runFlow(graphOf(), {
      router: async () => ({ __ports: ["a", "c"], value: { matched: true } }),
      ...sinks(seen),
    });

    expect(result.ok).toBe(true);
    // Both matched lanes ran, with the router's payload...
    expect(seen.A).toEqual({ matched: true });
    expect(seen.C).toEqual({ matched: true });
    // ...and the lane that did not match never ran at all.
    expect(seen).not.toHaveProperty("B");
  });

  it("gives each lit port its own payload when handed a map", async () => {
    const seen: Record<string, unknown> = {};
    await runFlow(graphOf(), {
      router: async () => ({ __ports: { a: { queue: "billing" }, c: { queue: "abuse" } } }),
      ...sinks(seen),
    });

    expect(seen.A).toEqual({ queue: "billing" });
    expect(seen.C).toEqual({ queue: "abuse" });
    expect(seen).not.toHaveProperty("B");
  });

  it("carries a per-port payload of null rather than falling back to the result", async () => {
    // The same distinction `branch` had to learn: a key that is present and null
    // is a payload, not an absent one. Getting this wrong leaks the wrapper.
    const seen: Record<string, unknown> = {};
    await runFlow(graphOf(), {
      router: async () => ({ __ports: { a: null } }),
      ...sinks(seen),
    });

    expect(Object.prototype.hasOwnProperty.call(seen, "A")).toBe(true);
    expect(seen.A).toBeNull();
  });

  it("lights nothing for an explicitly empty list", async () => {
    const seen: Record<string, unknown> = {};
    const result = await runFlow(graphOf(), {
      router: async () => ({ __ports: [] }),
      ...sinks(seen),
    });

    expect(result.ok).toBe(true);
    expect(seen).toEqual({});
  });

  it("emits one node-output event per lit port", async () => {
    const events: Array<{ portId?: string; value?: unknown }> = [];
    await runFlow(
      graphOf(),
      { router: async () => ({ __ports: { a: 1, c: 2 } }), ...sinks({}) },
      (e) => {
        if (e.type === "node-output" && e.nodeId === "r") events.push({ portId: e.portId, value: e.value });
      },
    );

    expect(events).toEqual([
      { portId: "a", value: 1 },
      { portId: "c", value: 2 },
    ]);
  });

  it("leaves the one-port and every-port rules exactly as they were", async () => {
    const one: Record<string, unknown> = {};
    await runFlow(graphOf(), { router: async () => ({ __port: "b", value: "only-b" }), ...sinks(one) });
    expect(one).toEqual({ B: "only-b" });

    const all: Record<string, unknown> = {};
    await runFlow(graphOf(), { router: async () => ({ plain: true }), ...sinks(all) });
    expect(Object.keys(all).sort()).toEqual(["A", "B", "C"]);
  });
});
