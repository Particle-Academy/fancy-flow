import { describe, it, expect, beforeAll } from "vitest";
import { sortNodesParentFirst, assignToLane, removeFromLane, stackLanes } from "../src/components/FlowEditor/graph-ops";
import { runFlow } from "../src/runtime/run-flow";
import { registerBuiltinKinds, getNodeKind } from "../src/registry";
import type { FlowGraph } from "../src/types";

const node = (id: string, x = 0, y = 0, extra: Record<string, unknown> = {}): any => ({
  id,
  position: { x, y },
  data: {},
  ...extra,
});

describe("sortNodesParentFirst", () => {
  it("orders a parent before its child regardless of input order", () => {
    const out = sortNodesParentFirst([node("child", 0, 0, { parentId: "lane" }), node("lane")]);
    expect(out.map((n) => n.id)).toEqual(["lane", "child"]);
  });
  it("is stable for unrelated nodes", () => {
    const out = sortNodesParentFirst([node("a"), node("b"), node("c")]);
    expect(out.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
});

describe("assignToLane / removeFromLane", () => {
  it("assign sets parentId + extent + a lane-relative position", () => {
    const out = assignToLane([node("lane", 100, 100), node("a", 180, 140)], "a", "lane");
    const a = out.find((n) => n.id === "a") as any;
    expect(a.parentId).toBe("lane");
    expect(a.extent).toBe("parent");
    expect(a.position).toEqual({ x: 80, y: 40 }); // 180-100, 140-100
  });
  it("remove restores absolute position + drops parentId", () => {
    const out = removeFromLane([node("lane", 100, 100), node("a", 80, 40, { parentId: "lane", extent: "parent" })], "a");
    const a = out.find((n) => n.id === "a") as any;
    expect(a.parentId).toBeUndefined();
    expect(a.extent).toBeUndefined();
    expect(a.position).toEqual({ x: 180, y: 140 }); // 80+100, 40+100
  });
  it("re-parents across lanes using absolute position", () => {
    const nodes = [node("L1", 0, 0), node("L2", 0, 300), node("a", 20, 40, { parentId: "L1", extent: "parent" })];
    // 'a' absolute = (20, 40); moving into L2 (at y=300) -> relative (20, -260)
    const out = assignToLane(nodes, "a", "L2");
    const a = out.find((n) => n.id === "a") as any;
    expect(a.parentId).toBe("L2");
    expect(a.position).toEqual({ x: 20, y: -260 });
  });
  it("assign is a no-op when a node or lane is missing", () => {
    const nodes = [node("a")];
    expect(assignToLane(nodes, "a", "nope")).toBe(nodes);
  });
});

describe("stackLanes", () => {
  it("packs horizontal lanes contiguously by height", () => {
    const isLane = (n: any) => n.id.startsWith("L");
    const out = stackLanes([node("L1", 0, 0, { height: 100 }), node("L2", 0, 500, { height: 150 }), node("x", 0, 0)], isLane, { gap: 10 });
    expect(out.find((n) => n.id === "L1")!.position.y).toBe(0);
    expect(out.find((n) => n.id === "L2")!.position.y).toBe(110); // 0 + 100 + 10
    expect(out.find((n) => n.id === "x")!.position).toEqual({ x: 0, y: 0 }); // non-lane untouched
  });
});

describe("runtime skips lane nodes", () => {
  beforeAll(() => registerBuiltinKinds());

  it("a lane is visual-only — never executed, no missing-executor error", async () => {
    expect(getNodeKind("@particle-academy/lane")?.category).toBe("layout");
    const graph: FlowGraph = {
      nodes: [
        { id: "t", type: "@particle-academy/manual_trigger", position: { x: 0, y: 0 }, data: { kind: "@particle-academy/manual_trigger", label: "T" } } as any,
        { id: "lane", type: "@particle-academy/lane", position: { x: 0, y: 0 }, width: 400, height: 150, data: { kind: "@particle-academy/lane", label: "Lane" } } as any,
      ],
      edges: [],
    };
    const statuses: Record<string, string> = {};
    await runFlow(graph, { "*": () => ({ ok: true }) } as any, (e: any) => {
      if (e.type === "node-status") statuses[e.nodeId] = `${e.status}${e.text ? `:${e.text}` : ""}`;
    });
    expect(statuses["lane"]).toContain("idle");
    expect(statuses["lane"]).not.toContain("error");
  });
});
