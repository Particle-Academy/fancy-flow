// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NodeConfigPanel } from "../src/components/NodeConfigPanel/NodeConfigPanel";
import { registerNodeKind } from "../src/registry";

/**
 * Hosts can render their own `ConfigField` types — issue #4.
 *
 * The panel had hooks for two *specific* types (`renderDocumentField`,
 * `renderCredentialField`) and no generic seam. Anything richer than the
 * built-ins had to be rendered OUTSIDE the panel, so that node's config stopped
 * living where every other field does — a side panel bolted alongside the one
 * the editor already shows.
 *
 * The reported case is a trigger-filter editor: rows of `{field, op, value}`
 * with operators like `contains` / `in` / `is_empty`. `keyvalue` can only
 * express `field = value`, so there was no built-in that could carry it and no
 * way to supply one.
 *
 * An unknown `type` also hit the renderer's `default:` and returned `null` —
 * the field vanished silently, which is the worst of the available failures:
 * the schema says the field exists and the panel shows nothing.
 */
beforeAll(() => {
  registerNodeKind({
    name: "@test/custom-fields",
    label: "Custom",
    category: "action",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
    configSchema: [
      { type: "text", key: "endpoint", label: "Endpoint" },
      // A type the package knows nothing about.
      { type: "trigger-filters", key: "filters", label: "Filters" },
      {
        type: "repeater",
        key: "rules",
        label: "Rules",
        fields: [{ type: "trigger-filters", key: "when", label: "When" }],
      },
    ],
  } as never);
});

afterEach(cleanup);

const node = {
  id: "n1",
  type: "@test/custom-fields",
  position: { x: 0, y: 0 },
  data: { kind: "@test/custom-fields", label: "Trigger", config: { filters: "seed" } },
} as never;

describe("NodeConfigPanel fieldRenderers", () => {
  it("renders a host-supplied renderer for an unknown field type", () => {
    render(
      <NodeConfigPanel
        node={node}
        onChange={vi.fn()}
        fieldRenderers={{
          "trigger-filters": ({ value }) => (
            <div data-testid="filter-editor">filters: {String(value)}</div>
          ),
        }}
      />,
    );

    expect(screen.getByTestId("filter-editor")).toBeTruthy();
    expect(screen.getByTestId("filter-editor").textContent).toContain("seed");
  });

  it("passes onChange through so the custom field can write config", () => {
    const onChange = vi.fn();
    render(
      <NodeConfigPanel
        node={node}
        onChange={onChange}
        fieldRenderers={{
          "trigger-filters": ({ onChange: set }) => (
            <button data-testid="set" onClick={() => set([{ field: "a", op: "contains" }])}>
              set
            </button>
          ),
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("set"));

    expect(onChange).toHaveBeenCalled();
  });

  it("can override a BUILT-IN type", () => {
    // Same seam either way: a host that wants react-fancy inputs, or a richer
    // editor for `text`, should not need a second mechanism.
    render(
      <NodeConfigPanel
        node={node}
        onChange={vi.fn()}
        fieldRenderers={{ text: () => <div data-testid="custom-text">mine</div> }}
      />,
    );

    expect(screen.getByTestId("custom-text")).toBeTruthy();
  });

  it("falls back to the default rendering when a renderer returns null", () => {
    // The documented escape: a host can claim a type conditionally and let the
    // package handle the rest, rather than reimplementing every case.
    render(
      <NodeConfigPanel
        node={node}
        onChange={vi.fn()}
        fieldRenderers={{ text: () => null }}
      />,
    );

    expect(screen.queryByTestId("custom-text")).toBeNull();
    // The built-in text control is still there.
    expect(document.querySelector('[data-ff-field="endpoint"]')).toBeTruthy();
  });

  it("leaves the built-ins alone when no renderers are given", () => {
    // Regression guard — passes before the change as well as after.
    render(<NodeConfigPanel node={node} onChange={vi.fn()} />);

    expect(document.querySelector('[data-ff-field="endpoint"]')).toBeTruthy();
  });

  it("reaches fields nested inside a repeater", () => {
    // The renderer recurses for repeater rows, and the first pass forwarded
    // every OTHER hook down that path but not this one — so a custom field
    // worked at the top level and silently vanished one level in, which is
    // exactly the kind of gap that only shows up in someone else's schema.
    render(
      <NodeConfigPanel
        node={{
          ...(node as Record<string, unknown>),
          data: {
            kind: "@test/custom-fields",
            label: "Trigger",
            config: { rules: [{ when: "row-seed" }] },
          },
        } as never}
        onChange={vi.fn()}
        fieldRenderers={{
          "trigger-filters": ({ value }) => (
            <div data-testid="nested">nested: {String(value)}</div>
          ),
        }}
      />,
    );

    const nested = screen.getAllByTestId("nested");

    expect(nested.length).toBeGreaterThan(1);
    expect(nested.map((n) => n.textContent).join(" ")).toContain("row-seed");
  });
});
