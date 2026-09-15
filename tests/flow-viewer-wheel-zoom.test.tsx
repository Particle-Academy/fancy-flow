/**
 * FlowViewer forwards `zoomOnWheel` to FlowCanvas (fancy-flow#18).
 *
 * The viewer rendered its canvas with React Flow's `zoomOnScroll={false}` and
 * offered no prop, so a read-only graph shown at a real size — a side panel,
 * an ops preview — could only be zoomed with the +/- buttons. The wheel did
 * nothing over it, while FlowCanvas already had `zoomOnWheel` with exactly the
 * semantics a consumer needs.
 *
 * `zoomOnScroll={false}` is not a milder version of "off": it disables wheel
 * zoom outright, Shift+wheel included, which is not what FlowCanvas's `off`
 * means. So the viewer must pass `zoomOnWheel` and nothing else about the wheel.
 *
 * Asserted on the props the viewer hands FlowCanvas, for the reason
 * canvas-zoom.test.ts gives: xyflow's zoom lives in d3-zoom behind a real
 * layout, and what the wheel does there is covered by `wheelZoomProps`.
 */
import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const seen: Array<Record<string, unknown>> = [];

vi.mock("../src/components/canvas", () => ({
  FlowCanvas: (props: Record<string, unknown>) => {
    seen.push(props);
    return null;
  },
}));

const { FlowViewer } = await import("../src/components/FlowViewer/FlowViewer");

const graph = {
  nodes: [{ id: "a", type: "llm_call", position: { x: 0, y: 0 }, data: { kind: "llm_call", label: "Summarize" } }],
  edges: [],
} as never;

const canvasProps = (element: React.ReactElement): Record<string, unknown> => {
  seen.length = 0;
  renderToStaticMarkup(element);
  expect(seen).toHaveLength(1);
  return seen[0]!;
};

describe("FlowViewer wheel zoom", () => {
  beforeEach(() => {
    seen.length = 0;
  });

  test("is off by default, so a viewer mid-page does not trap the reader's scroll", () => {
    expect(canvasProps(<FlowViewer graph={graph} />).zoomOnWheel).toBe(false);
  });

  test("turns on when asked: a bare wheel zooms", () => {
    expect(canvasProps(<FlowViewer graph={graph} zoomOnWheel />).zoomOnWheel).toBe(true);
  });

  test("does not also pass zoomOnScroll, which would disable wheel zoom outright", () => {
    // With zoomOnScroll={false} in the mix, `zoomOnWheel` would be ignored and
    // Shift+wheel would do nothing, which is the bug this closes.
    expect(canvasProps(<FlowViewer graph={graph} zoomOnWheel />)).not.toHaveProperty("zoomOnScroll");
    expect(canvasProps(<FlowViewer graph={graph} />)).not.toHaveProperty("zoomOnScroll");
  });

  test("leaves the read-only contract closed either way", () => {
    for (const props of [canvasProps(<FlowViewer graph={graph} />), canvasProps(<FlowViewer graph={graph} zoomOnWheel />)]) {
      expect(props.nodesDraggable).toBe(false);
      expect(props.nodesConnectable).toBe(false);
      expect(props.deleteKeyCode).toBeNull();
    }
  });
});
