// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NodeConfigPanel } from "../src/components/NodeConfigPanel/NodeConfigPanel";
import { FlowEditor, type FlowEditorApi } from "../src/components/FlowEditor";
import { registerNodeKind } from "../src/registry";
import { reactFancyFieldRenderers } from "../src/fields/react-fancy";

/**
 * `type: "json"` fields, and the two things wrong with how they were authored.
 *
 * **1. The built-in textarea ate invalid input.** It parsed on blur and, on a
 * `SyntaxError`, did nothing at all — the `catch` block's entire body was a
 * comment. Because the textarea is uncontrolled (`defaultValue`), the broken
 * text then STAYED on screen while the config kept the old value. So the panel
 * showed one document, the node ran a different one, and nothing anywhere said
 * so. A missing comma silently reverted an author's edit.
 *
 * That is the failure mode this package is least able to afford: `api_request`
 * bodies and `llm_call` input schemas are exactly where a stray character is
 * likely, and a workflow that runs with stale config looks like it worked.
 *
 * **2. There was no better editor to reach for.** react-fancy ships a real
 * `JsonEditor` — typed rows, add/remove, conflict reporting — and the panel had
 * no way to use it.
 *
 * The fix is deliberately NOT to import react-fancy into the panel.
 * `panel-labels.test.tsx` records why: fancy-flow themes through a `--ff-*`
 * token layer a host overrides on `.ff-editor`, while react-fancy's primitives
 * are hardcoded Tailwind classes that read no custom properties. Converting the
 * built-ins would trade the theming contract for a nicer widget.
 *
 * So it lives on an opt-in subpath — `@particle-academy/fancy-flow/fields/react-fancy`
 * — the same shape as `/llm/vercel-ai` and `/rich-input`. A host on react-fancy
 * gets the editor by passing `fieldRenderers`; a standalone host keeps a
 * textarea that no longer lies.
 */
beforeAll(() => {
  registerNodeKind({
    name: "@test/json-fields",
    label: "JSON fields",
    category: "action",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
    configSchema: [
      { type: "json", key: "body", label: "Body" },
      {
        type: "json",
        key: "typed",
        label: "Typed",
        keyMap: JSON.stringify({ retries: "integer", active: "boolean" }),
      },
      { type: "keyvalue", key: "headers", label: "Headers" },
      {
        type: "repeater",
        key: "rules",
        label: "Rules",
        fields: [{ type: "text", key: "left", label: "Left" }],
      },
    ],
  } as never);
});

afterEach(cleanup);

function makeNode(config: Record<string, unknown> = {}) {
  return {
    id: "n1",
    type: "@test/json-fields",
    position: { x: 0, y: 0 },
    data: { kind: "@test/json-fields", label: "Call", config },
  } as never;
}

function panel(props: Record<string, unknown> = {}, config?: Record<string, unknown>) {
  const onChange = vi.fn();
  const utils = render(<NodeConfigPanel node={makeNode(config)} onChange={onChange} {...props} />);
  return { onChange, ...utils };
}

/** The config object the panel most recently wrote. */
function lastConfig(onChange: ReturnType<typeof vi.fn>): Record<string, unknown> | undefined {
  const call = onChange.mock.calls.at(-1);
  return call?.[0]?.data?.config;
}

describe("the built-in JSON textarea", () => {
  it("commits parsed JSON", () => {
    const { onChange } = panel();
    const box = screen.getByLabelText("Body");

    fireEvent.change(box, { target: { value: '{"a":1}' } });
    fireEvent.blur(box);

    expect(lastConfig(onChange)).toEqual({ body: { a: 1 } });
  });

  it("REPORTS invalid JSON instead of silently discarding it", () => {
    // The regression that motivated this file. Before the fix `onChange` was
    // never called AND nothing was shown — the author's text sat in the box
    // looking accepted while the node kept its previous config.
    const { onChange } = panel();
    const box = screen.getByLabelText("Body");

    fireEvent.change(box, { target: { value: '{"a":1,}' } });
    fireEvent.blur(box);

    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/JSON|token/i);
    // Still refuses to write unparseable config — reporting is the fix, not
    // storing garbage.
    expect(lastConfig(onChange)?.body).toBeUndefined();
  });

  it("keeps the author's broken text on screen to be corrected", () => {
    // The other half: discarding the text as well would be worse than useless.
    panel();
    const box = screen.getByLabelText("Body") as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "{oops" } });
    fireEvent.blur(box);

    expect(box.value).toBe("{oops");
  });

  it("clears the error once the text parses again", () => {
    const { onChange } = panel();
    const box = screen.getByLabelText("Body");

    fireEvent.change(box, { target: { value: "{oops" } });
    fireEvent.blur(box);
    expect(screen.queryByRole("alert")).toBeTruthy();

    fireEvent.change(box, { target: { value: '{"ok":true}' } });
    fireEvent.blur(box);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(box.getAttribute("aria-invalid")).toBeNull();
    expect(lastConfig(onChange)).toEqual({ body: { ok: true } });
  });

  it("stays labelled and addressable", () => {
    // The handle contract every other field already met.
    panel();
    expect(screen.getByLabelText("Body").getAttribute("data-ff-field")).toBe("body");
  });
});

describe("the react-fancy field renderers", () => {
  it("renders a JsonEditor for a json field", () => {
    const { container } = panel({ fieldRenderers: reactFancyFieldRenderers }, {
      body: { service: "checkout", retries: 3 },
    });

    const editor = container.querySelector("[data-react-fancy-json-editor]");
    expect(editor).toBeTruthy();
    // The values are really there, not an empty shell.
    const rows = [...container.querySelectorAll("[data-react-fancy-json-editor-row]")];
    expect(rows.map((r) => r.getAttribute("data-key"))).toContain("service");
  });

  it("passes the field's keyMap through, so declared types reach the editor", () => {
    // Without this the editor is just a prettier textarea: `keyMap` is what
    // makes it type-aware, and it is a JSON STRING by design so it survives an
    // MCP round-trip.
    const { container } = panel({ fieldRenderers: reactFancyFieldRenderers }, {
      typed: { retries: 3, active: true },
    });

    const rows = [...container.querySelectorAll("[data-react-fancy-json-editor-row]")];
    const byKey = Object.fromEntries(
      rows.map((r) => [
        r.getAttribute("data-key"),
        { type: r.getAttribute("data-type"), declared: r.getAttribute("data-declared") },
      ]),
    );
    expect(byKey.retries).toEqual({ type: "integer", declared: "true" });
    expect(byKey.active).toEqual({ type: "boolean", declared: "true" });
  });

  it("writes edits back to the node config", () => {
    const { onChange, container } = panel({ fieldRenderers: reactFancyFieldRenderers }, {
      body: { retries: 3 },
    });

    const input = container.querySelector(
      '[data-react-fancy-json-editor-value][data-path="retries"] input',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    // JsonEditor commits on blur, not per keystroke — the same choice the
    // built-in textarea makes, for the same reason.
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);

    expect(lastConfig(onChange)?.body).toEqual({ retries: 5 });
  });

  it("claims ONLY the json type, leaving every other field to the package", () => {
    // The seam allows a renderer to claim a type conditionally. Claiming more
    // than `json` here would quietly replace the panel's own controls — and
    // that is the conversion `panel-labels.test.tsx` argued against.
    expect(Object.keys(reactFancyFieldRenderers)).toEqual(["json"]);

    const rendered = reactFancyFieldRenderers.json({
      field: { type: "text", key: "endpoint", label: "Endpoint" } as never,
      value: "x",
      onChange: vi.fn(),
    });
    expect(rendered).toBeNull();
  });
});

describe("composite fields are labelled", () => {
  // A `<label htmlFor>` pointing at an id that does not exist is worse than no
  // label: it reads as done. `repeater`, `keyvalue` and a host-rendered `json`
  // are containers, not labelable controls, and none of them ever received the
  // id the panel's label was pointing at.
  it.each([
    ["Headers", "headers"],
    ["Rules", "rules"],
  ])("gives the %s container the id its label points at", (label, key) => {
    const { container } = panel();

    const labelEl = [...container.querySelectorAll("label.ff-panel__label")].find(
      (l) => l.textContent?.trim().startsWith(label),
    ) as HTMLLabelElement | undefined;
    const forId = labelEl?.getAttribute("for");

    expect(forId, `no label rendered for ${label}`).toBeTruthy();
    const target = container.querySelector(`[id="${forId}"]`);
    expect(target, `label for="${forId}" points at nothing`).toBeTruthy();
    expect(target!.getAttribute("data-ff-field")).toBe(key);
  });

  it("labels a host-rendered json field too", () => {
    const { container } = panel({ fieldRenderers: reactFancyFieldRenderers });

    const editor = container.querySelector('[data-ff-field="body"]');
    expect(editor).toBeTruthy();
    expect(editor?.getAttribute("id")).toBeTruthy();
    const labelEl = container.querySelector(`label[for="${editor!.getAttribute("id")}"]`);
    expect(labelEl?.textContent?.trim()).toContain("Body");
  });
});

describe("FlowEditor reaches the field-renderer seam", () => {
  // React Flow needs these; jsdom has neither.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;

  /**
   * The seam shipped unreachable.
   *
   * `fieldRenderers` existed on `NodeConfigPanel` and was tested there — but
   * `FlowEditor`, which is what a host actually mounts, never forwarded it. The
   * only ways to supply one were to abandon `FlowEditor` and compose an editor
   * by hand, or to replace the whole panel through `slots.panel`. So the
   * feature was real, correct, unit-tested, and connected to nothing: the
   * showcase could not have used it.
   *
   * That is also why this test drives the REAL editor rather than the panel. A
   * second panel-level test would have passed against the broken build.
   */
  it("forwards fieldRenderers from FlowEditor down to the config panel", async () => {
    const graph = {
      nodes: [
        {
          id: "n1",
          type: "@test/json-fields",
          position: { x: 0, y: 0 },
          data: { kind: "@test/json-fields", label: "Call", config: { body: { service: "checkout" } } },
        },
      ],
      edges: [],
    };

    const apiRef = createRef<FlowEditorApi>();
    const { container } = render(
      <FlowEditor
        ref={apiRef}
        value={graph as never}
        onChange={vi.fn()}
        fieldRenderers={reactFancyFieldRenderers}
      />,
    );

    // Selection is internal state driven by pointer events React Flow owns;
    // the public imperative API is the honest way to reach it from a test.
    await act(async () => {
      apiRef.current?.select("n1");
    });

    const editor = container.querySelector("[data-react-fancy-json-editor]");
    expect(editor, "the json field did not render through the host renderer").toBeTruthy();
    expect(
      [...container.querySelectorAll("[data-react-fancy-json-editor-row]")].map((r) =>
        r.getAttribute("data-key"),
      ),
    ).toContain("service");
  });
});
