// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FlowEditor, type FlowEditorApi } from "../src/components/FlowEditor";
import { NodeConfigPanel } from "../src/components/NodeConfigPanel";
import { registerNodeKind } from "../src/registry";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub;

  registerNodeKind({
    name: "@test/filterable-fields",
    label: "Filterable",
    category: "ai",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
    configSchema: [
      { type: "text", key: "prompt", label: "Prompt" },
      { type: "text", key: "provider", label: "Provider", description: "Secret host policy", required: true },
    ],
  });
});

afterEach(cleanup);

const node = {
  id: "n1",
  type: "@test/filterable-fields",
  position: { x: 0, y: 0 },
  data: { kind: "@test/filterable-fields", label: "Call", config: {} },
} as never;

describe("NodeConfigPanel fieldFilter", () => {
  it("omits the complete field wrapper and passes node, kind, and field context", () => {
    const fieldFilter = vi.fn(({ field }) => field.key !== "provider");
    const { container } = render(
      <NodeConfigPanel node={node} onChange={vi.fn()} fieldFilter={fieldFilter} />,
    );

    expect(container.querySelector('[data-ff-field="prompt"]')).toBeTruthy();
    expect(container.querySelector('[data-ff-field="provider"]')).toBeNull();
    expect(container.textContent).not.toContain("Provider");
    expect(container.textContent).not.toContain("Secret host policy");
    expect(container.textContent).not.toContain("Provider is required");
    expect(fieldFilter).toHaveBeenCalledWith(expect.objectContaining({
      node: expect.objectContaining({ id: "n1" }),
      kind: expect.objectContaining({ name: "@test/filterable-fields" }),
      field: expect.objectContaining({ key: "provider" }),
    }));
  });

  it("forwards the filter through FlowEditor and removes an empty schema divider", async () => {
    const apiRef = createRef<FlowEditorApi>();
    const { container } = render(
      <FlowEditor
        ref={apiRef}
        value={{ nodes: [node], edges: [] }}
        onChange={vi.fn()}
        fieldFilter={() => false}
      />,
    );

    await act(async () => apiRef.current?.select("n1"));

    expect(container.querySelector('[data-ff-field="prompt"]')).toBeNull();
    expect(container.querySelector('[data-ff-field="provider"]')).toBeNull();
    expect(container.querySelector(".ff-panel__divider")).toBeNull();
  });
});
