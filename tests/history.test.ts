import { describe, it, expect } from "vitest";
import { createHistory } from "../src/runtime/history";
import type { FlowGraph } from "../src/types";

const g = (tag: string): FlowGraph => ({ nodes: [{ id: tag, position: { x: 0, y: 0 }, data: {} } as any], edges: [] });

describe("createHistory", () => {
  it("starts empty", () => {
    const h = createHistory();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo(g("cur"))).toBe(null);
    expect(h.redo(g("cur"))).toBe(null);
  });

  it("undo returns the last pushed snapshot and stashes current for redo", () => {
    const h = createHistory();
    h.push(g("a"));
    expect(h.canUndo()).toBe(true);
    const restored = h.undo(g("b"));
    expect(restored?.nodes[0].id).toBe("a");
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
    const redone = h.redo(g("a"));
    expect(redone?.nodes[0].id).toBe("b");
  });

  it("undo/redo walk a multi-step stack", () => {
    const h = createHistory();
    h.push(g("s0")); // before edit -> s1
    h.push(g("s1")); // before edit -> s2 (current)
    expect(h.size()).toEqual({ past: 2, future: 0 });
    const u1 = h.undo(g("s2"));
    expect(u1?.nodes[0].id).toBe("s1");
    const u2 = h.undo(g("s1"));
    expect(u2?.nodes[0].id).toBe("s0");
    expect(h.canUndo()).toBe(false);
    const r1 = h.redo(g("s0"));
    expect(r1?.nodes[0].id).toBe("s1");
  });

  it("a new push after undo truncates the redo branch", () => {
    const h = createHistory();
    h.push(g("a"));
    h.undo(g("b")); // future now has [b]
    expect(h.canRedo()).toBe(true);
    h.push(g("c")); // new branch
    expect(h.canRedo()).toBe(false);
    expect(h.size().future).toBe(0);
  });

  it("clear empties both stacks", () => {
    const h = createHistory();
    h.push(g("a"));
    h.undo(g("b"));
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });

  it("respects the size limit (drops the oldest)", () => {
    const h = createHistory(3);
    h.push(g("a"));
    h.push(g("b"));
    h.push(g("c"));
    h.push(g("d")); // "a" drops
    expect(h.size().past).toBe(3);
    // Undo three times reaches "b" (a was dropped), then stops.
    expect(h.undo(g("cur"))?.nodes[0].id).toBe("d");
    expect(h.undo(g("d"))?.nodes[0].id).toBe("c");
    expect(h.undo(g("c"))?.nodes[0].id).toBe("b");
    expect(h.undo(g("b"))).toBe(null);
  });
});
