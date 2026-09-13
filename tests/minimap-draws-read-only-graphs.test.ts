import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectMeasuredSizes, withMeasuredSizes } from "../src/components/canvas/measured-sizes";
import { minimapNodeColor } from "../src/components/canvas/minimap";
import { categoryAccent } from "../src/registry/registry";
import type { FlowNode } from "../src/types";

/**
 * fancy-flow #15: `<FlowViewer showMinimap />` drew an empty rectangle over the
 * graph.
 *
 * Two causes, both verified in a browser before this was written:
 *
 * 1. React Flow's `<MiniMap>` draws a node only when the node object the HOST
 *    passed has dimensions (`nodeHasDimensions(node.internals.userNode)`, in
 *    @xyflow/react 12's MiniMapNodes). The main canvas draws from React Flow's
 *    internal copy, which is measured regardless. A read-only viewer never
 *    applies node changes, so its node objects never gain `measured`: the graph
 *    rendered, and the minimap found zero nodes to draw.
 * 2. With nodes drawn, React Flow's dark defaults filled them #2b2b2b on a
 *    #141414 panel, which still reads as empty on a dark page.
 *
 * Asserted on the pure functions the canvas routes through, as canvas-zoom does:
 * React Flow measures through a real layout, so a jsdom render would be testing
 * a mock of the measurement rather than the fix.
 */
const node = (id: string, extra: Partial<FlowNode> = {}): FlowNode =>
  ({ id, type: "action", position: { x: 0, y: 0 }, data: { kind: "llm_call" }, ...extra }) as FlowNode;

describe("collectMeasuredSizes", () => {
  it("records the size React Flow reports for each node", () => {
    const sizes = collectMeasuredSizes({}, [
      { type: "dimensions", id: "a", dimensions: { width: 202, height: 51 } },
      { type: "dimensions", id: "b", dimensions: { width: 202, height: 66 } },
    ]);

    expect(sizes).toEqual({ a: { width: 202, height: 51 }, b: { width: 202, height: 66 } });
  });

  it("ignores every other kind of change", () => {
    const previous = {};
    expect(collectMeasuredSizes(previous, [{ type: "position", id: "a" }, { type: "select", id: "a" }])).toBe(previous);
  });

  it("returns the same map when nothing moved, so the canvas does not re-render in a loop", () => {
    const previous = { a: { width: 202, height: 51 } };
    expect(collectMeasuredSizes(previous, [{ type: "dimensions", id: "a", dimensions: { width: 202, height: 51 } }])).toBe(previous);
  });
});

describe("withMeasuredSizes", () => {
  it("gives a node the size the canvas measured when its host never applied one", () => {
    const [a] = withMeasuredSizes([node("a")], { a: { width: 202, height: 51 } });

    // This is the property MiniMap filters on. Without it the node is skipped.
    expect(a!.measured).toEqual({ width: 202, height: 51 });
  });

  it("leaves a node the host measured exactly as it was", () => {
    const measured = node("a", { measured: { width: 300, height: 90 } });
    const [a] = withMeasuredSizes([measured], { a: { width: 202, height: 51 } });

    expect(a).toBe(measured);
  });

  it("returns the same array when there is nothing to add", () => {
    const nodes = [node("a"), node("b")];
    expect(withMeasuredSizes(nodes, {})).toBe(nodes);
  });
});

describe("minimapNodeColor", () => {
  it("fills a node with its kind's accent, the colour of its header", () => {
    expect(minimapNodeColor(node("t", { data: { kind: "manual_trigger" } as never }))).toBe(categoryAccent("trigger"));
  });

  it("falls back to the neutral accent for a kind the registry does not know", () => {
    expect(minimapNodeColor(node("x", { data: { kind: "no_such_kind" } as never }))).toBe(categoryAccent("custom"));
  });
});

describe("FlowCanvas wiring", () => {
  // The functions above are only the fix if the canvas uses them. Removing the
  // call leaves every test in this file green and the minimap empty again, so
  // the wiring is pinned on the source, where a render in jsdom cannot see it.
  const source = readFileSync(new URL("../src/components/canvas/FlowCanvas.tsx", import.meta.url), "utf8");

  it("records measured sizes from every node change", () => {
    expect(source).toMatch(/setMeasuredSizes\(\(previous\) => collectMeasuredSizes\(previous, changes\)\)/);
  });

  it("hands React Flow the nodes with those sizes supplied", () => {
    expect(source).toMatch(/withMeasuredSizes\(sortNodesParentFirst\(nodes\), measuredSizes\)/);
    expect(source).toMatch(/nodes=\{orderedNodes\}/);
  });

  it("colours minimap nodes by kind", () => {
    expect(source).toMatch(/<MiniMap[^>]*nodeColor=\{minimapNodeColor\}/);
  });
});
