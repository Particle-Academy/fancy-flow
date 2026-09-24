/** @vitest-environment node */
import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const connections = vi.hoisted(() => vi.fn());

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useNodeConnections: connections,
    Handle: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
      React.createElement("div", props, children),
  };
});

import { NodeShell } from "../src/components/nodes/NodeShell";
import { RegistryNode } from "../src/registry/RegistryNode";

const node = (data: Record<string, unknown>) => ({
  id: "target",
  type: "action",
  data: { label: "Target", ...data },
  selected: false,
  dragging: false,
  zIndex: 0,
  xPos: 0,
  yPos: 0,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
} as never);

describe("undeclared inbound handles", () => {
  beforeEach(() => connections.mockReturnValue([]));

  test("anchors and names a target handle referenced by a real edge", () => {
    connections.mockReturnValue([{ edgeId: "e1", source: "source", target: "target", targetHandle: "context" }]);

    const html = renderToStaticMarkup(
      <NodeShell node={node({ inputs: [{ id: "in" }] })} accent="#000" tag="ACTION" />,
    );

    expect(html).toContain('data-flow-target-handle="context"');
    expect(html).toContain('aria-label="Input handle context"');
    expect(html).toContain('title="context"');
    expect(html).toContain(">context</span>");
  });

  test("does not invent a fallback when no edge references it", () => {
    const html = renderToStaticMarkup(
      <NodeShell node={node({ inputs: [{ id: "in" }] })} accent="#000" tag="ACTION" />,
    );

    expect(html).not.toContain("data-flow-target-handle");
    expect(html).not.toContain(">context</span>");
  });

  test("leaves a declared target handle on the normal port path", () => {
    connections.mockReturnValue([{ edgeId: "e1", source: "source", target: "target", targetHandle: "context" }]);

    const html = renderToStaticMarkup(
      <NodeShell node={node({ inputs: [{ id: "context" }] })} accent="#000" tag="ACTION" />,
    );

    expect(html).toContain('id="context"');
    expect(html).not.toContain("data-flow-target-handle");
    expect(html).not.toContain("ff-node__fallback-handle");
  });

  test("uses the same fallback anchor in the registry renderer used by FlowViewer", () => {
    connections.mockReturnValue([{ edgeId: "e1", source: "source", target: "target", targetHandle: "context" }]);

    const html = renderToStaticMarkup(
      <RegistryNode {...node({ kind: "@particle-academy/transform", inputs: [{ id: "in" }] })} />,
    );

    expect(html).toContain('data-flow-target-handle="context"');
    expect(html).toContain('aria-label="Input handle context"');
  });
});
