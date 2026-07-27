// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NodeConfigPanel } from "../src/components/NodeConfigPanel/NodeConfigPanel";
import { registerNodeKind } from "../src/registry";

/**
 * Every control in the config panel is labelled and addressable.
 *
 * None of them were. The editor's source contained **zero** `htmlFor`, zero
 * `id` on a control and zero `aria-label` — labels sat next to their inputs
 * without being attached to them. Clicking a label focused nothing, and a
 * screen reader announced the primary authoring surface of the package as a
 * column of unlabelled boxes.
 *
 * It also failed the suite's own Human+ contract, which asks that every
 * interactive element carry a stable identity so an agent targets it rather
 * than guessing at the DOM. `data-ff-field` is that handle, keyed by the field
 * so it survives a reordered schema.
 *
 * Worth stating what this deliberately did NOT do: swap these for react-fancy
 * inputs. fancy-flow themes itself through a `--ff-*` token layer a host can
 * override on `.ff-editor`, react-fancy's primitives are hardcoded Tailwind
 * palette classes that read no custom properties, and the renderer's docblock
 * offers `renderPanel` for hosts that want react-fancy anyway. Converting would
 * have broken the theming contract to fix a labelling bug.
 */
beforeAll(() => {
  registerNodeKind({
    name: "@test/labelled",
    label: "Labelled",
    category: "action",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
    configSchema: [
      { type: "text", key: "endpoint", label: "Endpoint", required: true },
      { type: "textarea", key: "body", label: "Body" },
      { type: "number", key: "retries", label: "Retries" },
      { type: "switch", key: "draft", label: "Draft" },
      { type: "select", key: "method", label: "Method", options: [{ value: "get", label: "GET" }] },
      { type: "expression", key: "when", label: "When" },
    ],
  } as never);
});

afterEach(cleanup);

const node = {
  id: "n1",
  type: "@test/labelled",
  position: { x: 0, y: 0 },
  data: { kind: "@test/labelled", label: "Call the API", config: {} },
} as never;

function panel() {
  return render(<NodeConfigPanel node={node} onChange={vi.fn()} />);
}

describe("NodeConfigPanel labelling", () => {
  it.each([
    ["Endpoint"],
    ["Body"],
    ["Retries"],
    ["Draft"],
    ["Method"],
    ["When"],
    ["Label"],
    ["Description"],
  ])("attaches the %s label to its control", (label) => {
    panel();

    // getByLabelText resolves through htmlFor/id — it finds nothing when a
    // label merely sits beside an input, which is exactly the old behaviour.
    expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeTruthy();
  });

  it("gives every control a stable handle keyed by its field", () => {
    const { container } = panel();

    const handles = Array.from(container.querySelectorAll("[data-ff-field]")).map((el) =>
      el.getAttribute("data-ff-field"),
    );

    expect(handles).toEqual(
      expect.arrayContaining(["label", "description", "endpoint", "body", "retries", "draft", "method", "when"]),
    );
  });

  it("keys the handle on the field, not its position", () => {
    // An index-based handle breaks the moment a schema is reordered, and an
    // agent that stored `field-3` would start writing to the wrong input.
    const { container } = panel();

    expect(container.querySelector('[data-ff-field="endpoint"]')?.tagName).toBe("INPUT");
    expect(container.querySelector('[data-ff-field="body"]')?.tagName).toBe("TEXTAREA");
    expect(container.querySelector('[data-ff-field="method"]')?.tagName).toBe("SELECT");
  });

  it("does not reuse ids between two panels on one page", () => {
    // A split view or a comparison mounts two. Shared ids would make a label
    // in one focus a control in the other.
    const a = panel();
    const b = panel();

    const idOf = (r: ReturnType<typeof panel>) =>
      r.container.querySelector('[data-ff-field="endpoint"]')?.getAttribute("id");

    expect(idOf(a)).toBeTruthy();
    expect(idOf(a)).not.toBe(idOf(b));
  });

  it("survives going from no selection to a node and back", () => {
    // React error #310. Every hook must run on every render, and the panel's
    // two useMemos used to sit AFTER the `if (!node)` early return — so it
    // called no hooks with nothing selected and several with a node. Selecting
    // a node blanked the whole editor.
    //
    // It reached production because nothing in this repo could render a
    // component to find out: vitest collected only `.test.ts`.
    const { rerender, container } = render(<NodeConfigPanel node={null} onChange={vi.fn()} />);
    expect(screen.getByText(/Select a node/)).toBeTruthy();

    rerender(<NodeConfigPanel node={node} onChange={vi.fn()} />);
    expect(container.querySelector('[data-ff-field="endpoint"]')).not.toBeNull();

    rerender(<NodeConfigPanel node={null} onChange={vi.fn()} />);
    expect(screen.getByText(/Select a node/)).toBeTruthy();
  });

  it("survives a node whose kind was never registered", () => {
    // The other early return, and the same hazard.
    const unknown = { ...node, data: { kind: "@test/nope", label: "?", config: {} } } as never;
    const { rerender, container } = render(<NodeConfigPanel node={unknown} onChange={vi.fn()} />);

    expect(screen.getByText(/Unknown kind/)).toBeTruthy();

    rerender(<NodeConfigPanel node={node} onChange={vi.fn()} />);
    expect(container.querySelector('[data-ff-field="endpoint"]')).not.toBeNull();
  });

  it("keeps the required marker out of the accessible name", () => {
    // The asterisk is aria-hidden, so the field is announced "Endpoint" rather
    // than "Endpoint star".
    panel();

    expect(screen.getByLabelText(/^Endpoint/).getAttribute("id")).toBeTruthy();
  });
});
