// @vitest-environment jsdom
/**
 * <MermaidDiagram> — a read-only Mermaid diagram drawn by FlowViewer.
 *
 * Covers the council's conditions that live in the component (CC-fancy-0060):
 * unsupported types show their source with a notice and are never drawn, and
 * labels are text. Plus the Human+ contract for a surface that has state:
 * the source/diagram view is controllable, every part has a stable data-*
 * handle, light and dark come from kit tokens, and the fit follows the
 * container rather than a fixed size.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MermaidDiagram,
  MermaidFence,
  mermaidEdgeView,
  mermaidDiagramHeight,
  mermaidBackEdges,
  mermaidNodeDirections,
} from "../src/components/MermaidDiagram";
import { fromMermaid } from "../src/mermaid";

// React Flow measures its container, and jsdom has none. Recorded so a test
// can deliver a size the way a browser would.
const observers: Array<{ cb: ResizeObserverCallback; targets: Element[] }> = [];
class ResizeObserverStub {
  entry: { cb: ResizeObserverCallback; targets: Element[] };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(el: Element) {
    this.entry.targets.push(el);
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

/** Deliver a width to every observer watching `el`, as a browser would. */
function resize(el: Element, width: number) {
  for (const o of observers) {
    if (!o.targets.includes(el)) continue;
    o.cb([{ target: el, contentRect: { width, height: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
  }
}

// Read as TEXT from cwd: under jsdom `import.meta.url` is http://, and a file
// that fails to collect reports as "no tests" rather than as a failure.
const STYLES = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

afterEach(() => {
  cleanup();
  observers.length = 0;
});

const FLOW = "flowchart LR\n  A[Start] --> B{Choose}\n  B -->|yes| C(Done)";
const root = (c: HTMLElement) => c.querySelector("[data-mermaid-diagram]") as HTMLElement;

describe("drawing a supported flowchart", () => {
  test("renders through FlowViewer with stable handles", () => {
    const { container } = render(<MermaidDiagram source={FLOW} id="d1" />);
    const el = root(container);
    expect(el.id).toBe("d1");
    expect(el.dataset.mermaidDiagramStatus).toBe("ok");
    expect(el.dataset.mermaidDiagramType).toBe("flowchart");
    expect(el.dataset.mermaidDiagramView).toBe("diagram");
    expect(container.querySelector('[data-flow-viewer="canvas"]')).not.toBeNull();
    expect(container.querySelector("[data-mermaid-diagram-toggle]")).not.toBeNull();
    expect(container.querySelector("[data-mermaid-diagram-copy]")).not.toBeNull();
  });

  test("every node renders with its id and shape as handles, and its label as text", () => {
    const { container } = render(<MermaidDiagram source={FLOW} />);
    const node = (id: string) => container.querySelector(`[data-mermaid-node="${id}"]`) as HTMLElement;
    expect(node("A").textContent).toBe("Start");
    expect(node("B").dataset.mermaidShape).toBe("diamond");
    expect(node("C").dataset.mermaidShape).toBe("round");
  });

  test("a label that looks like HTML stays text", () => {
    const { container } = render(
      <MermaidDiagram source={'flowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B["<script>x()</script>"]'} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('[data-mermaid-node="A"]')!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  test("onReport hands the host the import report", () => {
    const onReport = vi.fn();
    render(<MermaidDiagram source={FLOW} onReport={onReport} />);
    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ diagramType: "flowchart", nodeCount: 3 }));
  });
});

describe("diagrams it cannot draw", () => {
  test("an unsupported type shows its source and a not-supported-yet notice, and no canvas", () => {
    const source = "sequenceDiagram\n  Alice->>Bob: Hello";
    const { container } = render(<MermaidDiagram source={source} />);
    const el = root(container);
    expect(el.dataset.mermaidDiagramStatus).toBe("unsupported");
    expect(el.dataset.mermaidDiagramType).toBe("sequence");
    const notice = container.querySelector("[data-mermaid-diagram-notice]")!;
    expect(notice.textContent).toMatch(/sequence diagrams are not supported yet/i);
    expect(notice.getAttribute("role")).toBe("status");
    expect(container.querySelector("[data-mermaid-diagram-source]")!.textContent).toBe(source);
    expect(container.querySelector("[data-flow-viewer]")).toBeNull();
    // There is nothing to toggle to.
    expect(container.querySelector("[data-mermaid-diagram-toggle]")).toBeNull();
  });

  test("a diagram over the limits shows its source and says why", () => {
    const { container } = render(<MermaidDiagram source={FLOW} limits={{ maxNodes: 2 }} />);
    expect(root(container).dataset.mermaidDiagramStatus).toBe("error");
    expect(container.querySelector("[data-mermaid-diagram-notice]")!.textContent).toMatch(/maxNodes/);
    expect(container.querySelector("[data-flow-viewer]")).toBeNull();
  });

  test("a partly readable flowchart is drawn with a notice listing what was left out", () => {
    const { container } = render(<MermaidDiagram source={"flowchart LR\n  A --> B\n  C@{ shape: rounded }"} />);
    expect(root(container).dataset.mermaidDiagramStatus).toBe("partial");
    expect(container.querySelector("[data-flow-viewer]")).not.toBeNull();
    const items = container.querySelectorAll("[data-mermaid-diagram-issues] li");
    expect(items.length).toBe(1);
    expect(items[0].textContent).toMatch(/line 3/);
  });
});

describe("the view is controllable", () => {
  test("uncontrolled: the toggle switches between diagram and source", () => {
    const { container } = render(<MermaidDiagram source={FLOW} />);
    fireEvent.click(container.querySelector("[data-mermaid-diagram-toggle]")!);
    expect(root(container).dataset.mermaidDiagramView).toBe("source");
    expect(container.querySelector("[data-mermaid-diagram-source]")!.textContent).toBe(FLOW);
    expect(container.querySelector("[data-flow-viewer]")).toBeNull();
    fireEvent.click(container.querySelector("[data-mermaid-diagram-toggle]")!);
    expect(root(container).dataset.mermaidDiagramView).toBe("diagram");
  });

  test("controlled: the host owns the view, the toggle only asks", () => {
    const onViewChange = vi.fn();
    const { container, rerender } = render(<MermaidDiagram source={FLOW} view="source" onViewChange={onViewChange} />);
    fireEvent.click(container.querySelector("[data-mermaid-diagram-toggle]")!);
    expect(onViewChange).toHaveBeenCalledWith("diagram");
    expect(root(container).dataset.mermaidDiagramView).toBe("source");
    rerender(<MermaidDiagram source={FLOW} view="diagram" onViewChange={onViewChange} />);
    expect(root(container).dataset.mermaidDiagramView).toBe("diagram");
  });

  test("the toggle says what it does and whether it is pressed", () => {
    const { container } = render(<MermaidDiagram source={FLOW} />);
    const toggle = container.querySelector("[data-mermaid-diagram-toggle]")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toMatch(/source/i);
  });
});

describe("copy", () => {
  test("copies the source through the host's writer and reports it", async () => {
    const clipboardWriter = vi.fn(async () => {});
    const onCopy = vi.fn();
    const { container } = render(<MermaidDiagram source={FLOW} clipboardWriter={clipboardWriter} onCopy={onCopy} />);
    await act(async () => {
      fireEvent.click(container.querySelector("[data-mermaid-diagram-copy]")!);
    });
    expect(clipboardWriter).toHaveBeenCalledWith(FLOW);
    expect(onCopy).toHaveBeenCalledWith({ text: FLOW, ok: true });
  });

  test("a failed write is reported as failed, never as copied", async () => {
    const onCopy = vi.fn();
    const { container } = render(
      <MermaidDiagram source={FLOW} clipboardWriter={() => Promise.reject(new Error("denied"))} onCopy={onCopy} />,
    );
    await act(async () => {
      fireEvent.click(container.querySelector("[data-mermaid-diagram-copy]")!);
    });
    expect(onCopy).toHaveBeenCalledWith({ text: FLOW, ok: false });
    expect(container.querySelector("[data-mermaid-diagram-copy]")!.textContent).not.toMatch(/copied/i);
  });

  test("unsupported diagrams can still be copied", () => {
    const { container } = render(<MermaidDiagram source={"gantt\n  title Plan"} />);
    expect(container.querySelector("[data-mermaid-diagram-copy]")).not.toBeNull();
  });
});

describe("theme and fit", () => {
  test("an explicit colour mode is applied and exposed", () => {
    const { container } = render(<MermaidDiagram source={FLOW} colorMode="dark" />);
    expect(root(container).dataset.colorMode).toBe("dark");
    expect(container.querySelector(".ff-canvas.dark")).not.toBeNull();
  });

  test("its styles come from the kit's --ff-* tokens, not fixed colours", () => {
    const rules = STYLES.slice(STYLES.indexOf("/* ─── Mermaid diagram"));
    expect(rules.length).toBeGreaterThan(200);
    expect(rules).toContain("var(--ff-node-bg)");
    expect(rules).toContain("var(--ff-fg)");
    expect(rules).toContain("var(--ff-border-strong)");
    // No literal hex colours in the Mermaid rules: a hex here is a colour that
    // will not follow dark mode.
    const block = rules.slice(0, rules.indexOf("/* ─── end Mermaid diagram"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test("height follows the container's width", () => {
    const { container } = render(<MermaidDiagram source={FLOW} />);
    const el = root(container);
    act(() => resize(el, 900));
    expect(el.dataset.mermaidDiagramWidth).toBe("900");
    const wide = parseFloat((container.querySelector(".ff-canvas") as HTMLElement).style.height);
    act(() => resize(el, 300));
    const narrow = parseFloat((container.querySelector(".ff-canvas") as HTMLElement).style.height);
    expect(el.dataset.mermaidDiagramWidth).toBe("300");
    expect(narrow).toBeLessThan(wide);
    expect(narrow).toBeGreaterThanOrEqual(160);
  });

  test("an explicit height wins", () => {
    const { container } = render(<MermaidDiagram source={FLOW} height={333} />);
    expect((container.querySelector(".ff-canvas") as HTMLElement).style.height).toBe("333px");
  });

  test("the height rule clamps and keeps the diagram's shape", () => {
    const { graph } = fromMermaid(FLOW);
    const at = (w: number) => mermaidDiagramHeight(graph!, w, { min: 160, max: 560 });
    expect(at(2000)).toBeLessThanOrEqual(560);
    expect(at(10)).toBe(160);
    expect(at(600)).toBeLessThanOrEqual(at(900));
  });
});

describe("edges are drawn as Mermaid wrote them", () => {
  const edge = (src: string) => mermaidEdgeView(fromMermaid(`flowchart LR\n  A ${src} B`).graph!.edges[0], "m");

  test("arrows, dotted, thick and invisible", () => {
    expect(edge("-->").markerEnd).toMatchObject({ type: "arrowclosed" });
    expect(edge("---").markerEnd).toBeUndefined();
    expect(edge("-.->").style).toMatchObject({ strokeDasharray: "5 4" });
    expect(edge("==>").style).toMatchObject({ strokeWidth: 3 });
    expect(edge("~~~").hidden).toBe(true);
    expect(edge("<-->").markerStart).toMatchObject({ type: "arrowclosed" });
  });

  test("circle and cross ends use their own markers, not an arrow", () => {
    expect(edge("--o").markerEnd).toBe("m-circle");
    expect(edge("--x").markerEnd).toBe("m-cross");
  });

  test("labels pass through as text", () => {
    expect(edge("-->|<b>hi</b>|").label).toBe("<b>hi</b>");
  });
});

// A cycle edge (B --> A after A --> B) is laid out with its target BEHIND its
// source. Drawn between the normal out/in handles, xyflow's bezier for two nodes
// on one row is a flat line under both nodes and the forward edge: the edge and
// its label vanish. Seen in a headless browser on 2026-11-24 (CC-fancy-0060).
describe("back edges loop around instead of lying under the nodes", () => {
  const backs = (src: string) => {
    const g = fromMermaid(src).graph!;
    const ids = mermaidBackEdges(g, mermaidNodeDirections(g, g.mermaid?.direction ?? "TB"));
    return g.edges.filter((e) => ids.has(e.id)).map((e) => `${e.source}>${e.target}`);
  };

  test("a cycle edge is a back edge, the forward edges are not", () => {
    expect(backs("flowchart LR\n  A --> B\n  B --> C\n  C -.->|no| A")).toEqual(["C>A"]);
    expect(backs("flowchart TB\n  A --> B\n  B --> A")).toEqual(["B>A"]);
    expect(backs("flowchart RL\n  A --> B\n  B --> A")).toEqual(["B>A"]);
    expect(backs("flowchart BT\n  A --> B\n  B --> A")).toEqual(["B>A"]);
    expect(backs("flowchart LR\n  A --> B --> C\n  A --> C")).toEqual([]);
  });

  test("inside a subgraph, by that subgraph's own direction", () => {
    expect(backs("flowchart LR\n  subgraph s\n    direction TB\n    A --> B\n    B --> A\n  end")).toEqual(["B>A"]);
  });

  test("edges across containers and self-loops keep the normal route", () => {
    expect(backs("flowchart LR\n  subgraph s\n    A --> B\n  end\n  B --> C\n  C --> A")).toEqual([]);
    expect(backs("flowchart LR\n  A --> A")).toEqual([]);
  });

  test("a back edge leaves and enters by the side handles, on a stepped path", () => {
    const g = fromMermaid("flowchart LR\n  A --> B\n  B -.->|no| A").graph!;
    const back = mermaidEdgeView(g.edges[1], "m", true);
    expect(back).toMatchObject({ type: "smoothstep", sourceHandle: "back-out", targetHandle: "back-in", label: "no" });
    expect(back.style).toMatchObject({ strokeDasharray: "5 4" });
    const forward = mermaidEdgeView(g.edges[0], "m");
    expect(forward.type).toBe("default");
    expect(forward.sourceHandle).toBeUndefined();
    expect(forward.targetHandle).toBeUndefined();
  });

  test("every node carries the side handles, after the normal ones", () => {
    const { container } = render(<MermaidDiagram source={"flowchart LR\n  A --> B\n  B --> A"} />);
    resize(root(container), 800);
    const node = container.querySelector('[data-mermaid-node="A"]');
    expect(node).not.toBeNull();
    const ids = [...node!.querySelectorAll(".react-flow__handle")].map((h) => h.getAttribute("data-handleid"));
    expect(ids).toEqual([null, null, "back-in", "back-out"]);
  });
});

describe("MermaidFence", () => {
  test("renders a ContentRenderer fence's code as a diagram", () => {
    const { container } = render(<MermaidFence code={FLOW} language="mermaid" info="mermaid" />);
    expect(root(container).dataset.mermaidDiagramStatus).toBe("ok");
    expect(container.querySelector('[data-mermaid-node="A"]')).not.toBeNull();
  });
});
