import { describe, it, expect, beforeAll } from "vitest";
import { applyOutputsToNodes } from "../src/runtime/use-flow-run";
import { registerNodeKind } from "../src/registry";

beforeAll(() => {
  registerNodeKind({ name: "test_reactive", category: "data", label: "Reactive", reactive: true } as any);
  registerNodeKind({ name: "test_plain", category: "data", label: "Plain" } as any);
});

describe("applyOutputsToNodes", () => {
  it("writes data.output for reactive kinds only", () => {
    const nodes = [
      { id: "r", type: "test_reactive", data: { kind: "test_reactive" } },
      { id: "p", type: "test_plain", data: { kind: "test_plain" } },
    ] as any;
    const out = applyOutputsToNodes(nodes, { r: 42, p: 99 });
    expect((out[0].data as any).output).toBe(42); // reactive → written
    expect((out[1].data as any).output).toBeUndefined(); // plain → untouched
  });

  it("leaves a reactive node without a matching output untouched (same ref)", () => {
    const nodes = [{ id: "r", type: "test_reactive", data: { kind: "test_reactive" } }] as any;
    const out = applyOutputsToNodes(nodes, {});
    expect(out[0]).toBe(nodes[0]);
  });

  it("resolves the kind from data.kind (namespaced) as well as type", () => {
    const nodes = [{ id: "r", type: undefined, data: { kind: "test_reactive" } }] as any;
    const out = applyOutputsToNodes(nodes, { r: "hello" });
    expect((out[0].data as any).output).toBe("hello");
  });
});
