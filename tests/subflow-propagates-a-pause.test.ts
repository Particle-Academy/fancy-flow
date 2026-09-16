/**
 * A human gate one level down must still decode at the top (fancy-flow-php#21).
 *
 * A pause and a failure travel the SAME channel — `ctx.abort` with an encoded
 * reason — and `decodePause` is prefix-anchored (`reason.startsWith(PAUSE_PREFIX)`).
 * So wrapping an unsuccessful child run as `subflow "x" failed: <reason>` did
 * not merely decorate the text: it moved the prefix off position 0 and the
 * pause stopped decoding entirely.
 *
 * What that cost, before 0.77.0: the durable coordinator read a FAILED run
 * instead of one parked on a person, so a `human_approval` or `user_input`
 * inside a subflow could never be answered, and retry policy counted someone's
 * pending decision as a fault — burning attempts against a human being's lunch
 * break. The run looked finished and failed, which is the quiet kind of wrong.
 *
 * The Rust twin never had this and carries a comment at the same line saying
 * why. This runtime, PHP and Python all did.
 *
 * **Assert that a pause DECODES; never assert on its text.** The reason is
 * verbatim by contract, so a test pinned to the wording would pass against the
 * very decoration it exists to stop.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { registerWorkflowResolver } from "../src/registry/capabilities";
import { decodePause, pauseForHuman } from "../src/registry/pause";
import { subflowExecutor } from "../src/registry/subflow";
import type { FlowGraph } from "../src/types";

const child: FlowGraph = {
  nodes: [{ id: "gate", type: "hostGate", position: { x: 0, y: 0 }, data: { kind: "hostGate", config: {} } }],
  edges: [],
} as never;

const parent: FlowGraph = {
  nodes: [
    { id: "sf", type: "subflow", position: { x: 0, y: 0 }, data: { kind: "subflow", config: { workflow: "child" } } },
  ],
  edges: [],
} as never;

beforeEach(() => {
  registerBuiltinKinds();
  registerWorkflowResolver(() => child);
});

describe("a pause raised inside a subflow", () => {
  it("reaches the top still decodable", async () => {
    const result = await runFlow(
      parent,
      {
        subflow: subflowExecutor,
        hostGate: (ctx: any) => pauseForHuman(ctx, "approval", { title: "Approve item" }),
      } as never,
    );

    expect(result.ok).toBe(false);

    const pause = decodePause(result.error);
    expect(pause).not.toBeNull();
    expect(pause!.nodeId).toBe("gate");
    expect(pause!.awaiting).toBe("approval");
  });

  it("still names the subflow when the child genuinely FAILS", async () => {
    // The other half. The `subflow "x" failed:` prefix is real context for a
    // real failure and must survive the fix — otherwise a child error arrives
    // at the top with nothing saying which child produced it.
    const result = await runFlow(
      parent,
      {
        subflow: subflowExecutor,
        hostGate: (ctx: any) => ctx.abort("the child exploded"),
      } as never,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('subflow "child" failed:');
    expect(result.error).toContain("the child exploded");
    expect(decodePause(result.error)).toBeNull();
  });
});
