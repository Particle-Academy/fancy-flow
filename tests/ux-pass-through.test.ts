import { describe, expect, it, vi } from "vitest";
import { createFlowRunnerUx } from "../src/ux";
import { getNodeKind } from "../src/registry/registry";

describe("FlowRunnerUx pass-through effects", () => {
  it("can receive resolved inputs, await the host, and then pass input downstream", async () => {
    let close!: () => void;
    const closed = new Promise<void>((resolve) => { close = resolve; });
    const effect = vi.fn(async (params: any) => {
      await closed;
      return { dismissed: true, received: params.$inputs.in.title };
    });
    const ux = createFlowRunnerUx({
      effects: { outcome: effect },
      meta: { outcome: { includeInputs: true, passThrough: true } },
    });
    ux.registerKinds();

    const node = { id: "result", type: "ux_outcome", position: { x: 0, y: 0 }, data: {
      kind: "ux_outcome", label: "Outcome", config: { tone: "gold" },
    } } as any;
    const execution = ux.executors.ux_outcome!({
      node,
      inputs: { in: { title: "A real boy", ending: "win" } },
      emit: vi.fn(),
      abort: vi.fn(),
    });

    await vi.waitFor(() => expect(effect).toHaveBeenCalledWith({
      tone: "gold",
      $inputs: { in: { title: "A real boy", ending: "win" } },
    }));
    let settled = false;
    void Promise.resolve(execution).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    close();
    await expect(execution).resolves.toEqual({ title: "A real boy", ending: "win" });
    expect(getNodeKind("ux_outcome")).toMatchObject({
      inputs: [{ id: "in" }],
      outputs: [{ id: "out" }],
      emits: "input",
      sideEffects: "unsafe-to-replay",
    });
  });
});
