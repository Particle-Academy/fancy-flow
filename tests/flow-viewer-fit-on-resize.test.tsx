// @vitest-environment jsdom
/**
 * FlowViewer's additive props for embedders: `nodeTypes` (merged over the
 * registry's), `colorMode` (forwarded), and `fitOnResize` (refit when the box
 * changes size). Asserted on what the viewer hands FlowCanvas, as the wheel-zoom
 * test does, because React Flow's fit lives behind a real layout.
 */
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

const seen: Array<Record<string, any>> = [];
vi.mock("../src/components/canvas", () => ({
  FlowCanvas: (props: Record<string, unknown>) => {
    seen.push(props);
    return null;
  },
}));

const observers: Array<{ cb: () => void; targets: Element[]; disconnected: boolean }> = [];
(globalThis as any).ResizeObserver = class {
  entry: { cb: () => void; targets: Element[]; disconnected: boolean };
  constructor(cb: () => void) {
    this.entry = { cb, targets: [], disconnected: false };
    observers.push(this.entry);
  }
  observe(el: Element) {
    this.entry.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.entry.disconnected = true;
  }
};

const { FlowViewer } = await import("../src/components/FlowViewer/FlowViewer");

const graph = {
  nodes: [{ id: "a", type: "note", position: { x: 0, y: 0 }, data: { kind: "note", label: "A" } }],
  edges: [],
} as never;

afterEach(() => {
  cleanup();
  seen.length = 0;
  observers.length = 0;
});

describe("FlowViewer embedder props", () => {
  test("nodeTypes are merged over the registry's, not instead of them", () => {
    const Custom = () => null;
    render(<FlowViewer graph={graph} nodeTypes={{ note: Custom }} />);
    const types = seen.at(-1)!.nodeTypes;
    expect(types.note).toBe(Custom);
    // A registry kind is still there.
    expect(Object.keys(types).length).toBeGreaterThan(10);
  });

  test("colorMode is forwarded", () => {
    render(<FlowViewer graph={graph} colorMode="dark" />);
    expect(seen.at(-1)!.colorMode).toBe("dark");
  });

  test("without fitOnResize nothing observes the box", () => {
    render(<FlowViewer graph={graph} />);
    expect(observers).toHaveLength(0);
  });

  test("with fitOnResize a size change refits the graph", () => {
    const { container } = render(<FlowViewer graph={graph} fitOnResize />);
    const fitView = vi.fn();
    act(() => seen.at(-1)!.onInit({ fitView }));
    const box = container.querySelector('[data-flow-viewer="canvas"]')!;
    const observer = observers.find((o) => o.targets.includes(box));
    expect(observer).toBeTruthy();
    act(() => observer!.cb());
    expect(fitView).toHaveBeenCalledWith({ padding: 0.2 });
  });

  test("the observer is released on unmount", () => {
    const { unmount } = render(<FlowViewer graph={graph} fitOnResize />);
    unmount();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });
});
