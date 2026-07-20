import { describe, it, expect, vi } from "vitest";
import {
  encodePause,
  decodePause,
  isPause,
  pauseForHuman,
  PAUSE_PREFIX,
  LEGACY_PAUSE_PREFIXES,
} from "../src/registry/pause";
import { registerBuiltinKinds, getNodeKind } from "../src/registry";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph, NodeExecutor } from "../src/types";

registerBuiltinKinds();

describe("pause encoding", () => {
  it("round-trips a signal", () => {
    const signal = { nodeId: "n1", awaiting: "input" as const, detail: { fields: ["email"] } };
    expect(decodePause(encodePause(signal))).toEqual(signal);
  });

  it("omits detail rather than encoding undefined", () => {
    const encoded = encodePause({ nodeId: "n1", awaiting: "approval" });
    expect(encoded).toBe(`${PAUSE_PREFIX}{"nodeId":"n1","awaiting":"approval"}`);
    expect(decodePause(encoded)).toEqual({ nodeId: "n1", awaiting: "approval" });
    expect(decodePause(encoded)).not.toHaveProperty("detail");
  });

  it("survives a node id containing a colon", () => {
    // The reason a delimited encoding was rejected: positional parsing breaks
    // on user data, and only ever in someone else's graph.
    const signal = { nodeId: "group:1:step:2", awaiting: "input" as const };
    expect(decodePause(encodePause(signal))).toEqual(signal);
  });

  it("carries an author-defined awaiting value through untouched", () => {
    const signal = { nodeId: "n1", awaiting: "signature", detail: { docId: 7 } };
    expect(decodePause(encodePause(signal))).toEqual(signal);
  });

  it("preserves an explicitly null detail", () => {
    const signal = { nodeId: "n1", awaiting: "input" as const, detail: null };
    expect(decodePause(encodePause(signal))).toEqual(signal);
  });
});

describe("decodePause rejects non-pauses", () => {
  it.each([
    ["a real failure", "Request failed with status 500"],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["the prefix with a malformed body", `${PAUSE_PREFIX}{not json`],
    ["a payload missing nodeId", `${PAUSE_PREFIX}{"awaiting":"input"}`],
    ["a payload missing awaiting", `${PAUSE_PREFIX}{"nodeId":"n1"}`],
    ["a payload with a non-string nodeId", `${PAUSE_PREFIX}{"nodeId":7,"awaiting":"input"}`],
  ])("returns null for %s", (_label, reason) => {
    expect(decodePause(reason as string | null | undefined)).toBeNull();
    expect(isPause(reason as string | null | undefined)).toBe(false);
  });
});

describe("legacy prefixes stay decodable", () => {
  // Runs that paused under an older version have these strings sitting in a
  // database column. A resume path that only works for new runs strands them.
  it.each([
    ["awaiting-approval:node-7", "node-7", "approval"],
    ["awaiting-input:node-7", "node-7", "input"],
  ])("decodes %s", (reason, nodeId, awaiting) => {
    expect(decodePause(reason)).toEqual({ nodeId, awaiting });
  });

  it("keeps a legacy node id containing a colon intact", () => {
    expect(decodePause("awaiting-input:a:b")).toEqual({ nodeId: "a:b", awaiting: "input" });
  });

  it("exposes both prefixes it must honour", () => {
    expect(LEGACY_PAUSE_PREFIXES.map(([p]) => p)).toEqual(["awaiting-approval:", "awaiting-input:"]);
  });
});

describe("pauseForHuman", () => {
  it("aborts with the encoded reason", () => {
    const abort = vi.fn((reason?: string) => {
      throw new Error(reason);
    }) as unknown as (reason?: string) => never;
    const ctx = { node: { id: "n9" }, abort };

    expect(() => pauseForHuman(ctx, "input", { q: 1 })).toThrow();
    expect(abort).toHaveBeenCalledWith(encodePause({ nodeId: "n9", awaiting: "input", detail: { q: 1 } }));
  });
});

describe("a paused run is distinguishable from a failed one", () => {
  const graph = (kind: string): FlowGraph => ({
    nodes: [
      { id: "t", type: "manual_trigger", position: { x: 0, y: 0 }, data: {} },
      { id: "h", type: kind, position: { x: 0, y: 100 }, data: {} },
    ] as FlowGraph["nodes"],
    edges: [{ id: "e", source: "t", target: "h" }] as FlowGraph["edges"],
  });

  it("reports a pause through result.error, decodable by the runner", async () => {
    // The end-to-end shape a durable runner sees: the executor pauses, the
    // engine records it as an error, and decodePause tells them apart.
    const executors: Record<string, NodeExecutor> = {
      manual_trigger: () => ({}),
      user_input: (ctx) => pauseForHuman(ctx, "input", { fields: ["email"] }),
    };

    const result = await runFlow(graph("user_input"), executors, () => {});

    expect(result.ok).toBe(false);
    const signal = decodePause(result.error);
    expect(signal).toEqual({ nodeId: "h", awaiting: "input", detail: { fields: ["email"] } });
  });

  it("does not mistake a genuine failure for a pause", async () => {
    const executors: Record<string, NodeExecutor> = {
      manual_trigger: () => ({}),
      user_input: () => {
        throw new Error("database is down");
      },
    };

    const result = await runFlow(graph("user_input"), executors, () => {});

    expect(result.ok).toBe(false);
    expect(result.error).toBe("database is down");
    expect(decodePause(result.error)).toBeNull();
  });
});

describe("kinds declare that they pause", () => {
  it.each([
    ["user_input", "input"],
    ["rich_user_input", "input"],
    ["human_approval", "approval"],
  ])("%s declares pausesForHuman=%s", (kind, awaiting) => {
    expect(getNodeKind(kind)?.pausesForHuman).toBe(awaiting);
  });

  it("does not mark kinds that never wait for a person", () => {
    // The declaration is only useful if it is accurate — a host reads it to
    // decide whether it needs a resume path at all.
    for (const kind of ["http", "transform", "branch", "llm_router"]) {
      expect(getNodeKind(kind)?.pausesForHuman).toBeUndefined();
    }
  });
});
