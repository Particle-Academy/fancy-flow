// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NodeConfigPanel } from "../src/components/NodeConfigPanel/NodeConfigPanel";
import {
  applyCompletion,
  filterVariables,
  findTrigger,
} from "../src/components/NodeConfigPanel/ExpressionField";
import { registerNodeKind } from "../src/registry";
import type { FlowGraph } from "../src/types";

/**
 * The authoring half of issue #5: typing `{{ ` offers what is reachable HERE.
 *
 * Before this, an expression field was a bare textarea with a placeholder. The
 * author had to know the grammar AND the upstream node's output shape, with
 * nothing in the editor to discover either from.
 */
beforeAll(() => {
  registerNodeKind({
    name: "@test/x-llm",
    label: "LLM",
    category: "action",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
    outputShape: [
      { path: "text", type: "string", description: "The model's reply." },
      { path: "tokens", type: "number" },
    ],
  } as never);

  registerNodeKind({
    name: "@test/x-sink",
    label: "Sink",
    category: "action",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
    configSchema: [{ type: "expression", key: "body", label: "Body" }],
  } as never);
});

afterEach(cleanup);

const GRAPH: FlowGraph = {
  nodes: [
    { id: "a", type: "@test/x-llm", position: { x: 0, y: 0 }, data: { kind: "@test/x-llm", label: "Summarize", config: {} } },
    { id: "b", type: "@test/x-sink", position: { x: 200, y: 0 }, data: { kind: "@test/x-sink", label: "Send", config: {} } },
  ] as never,
  edges: [{ id: "e1", source: "a", target: "b" }] as never,
};

function panel(withGraph = true) {
  const onChange = vi.fn();
  const utils = render(
    <NodeConfigPanel
      node={GRAPH.nodes[1] as never}
      onChange={onChange}
      graph={withGraph ? GRAPH : undefined}
    />,
  );
  return { onChange, ...utils };
}

/** The value the panel most recently wrote for `body`. */
function lastBody(onChange: ReturnType<typeof vi.fn>): unknown {
  return onChange.mock.calls.at(-1)?.[0]?.data?.config?.body;
}

describe("findTrigger", () => {
  it("opens inside an unclosed {{", () => {
    expect(findTrigger("hello {{ te", 11)).toEqual({ open: 6, query: "te" });
  });

  it("stays closed after the expression is finished", () => {
    // The bug this guards: re-opening the picker while the author types
    // ordinary prose after a completed expression.
    expect(findTrigger("{{ $json.text }} and more", 25)).toBeNull();
  });

  it("uses the caret, not the end of the string", () => {
    // Clicking back into an earlier expression must reopen THAT one.
    expect(findTrigger("{{ a }} tail", 4)).toEqual({ open: 0, query: "a" });
  });

  it("is null with no braces at all", () => {
    expect(findTrigger("plain text", 10)).toBeNull();
  });
});

describe("filterVariables", () => {
  const vars = [
    { expression: "{{ $json }}", path: "$json" },
    { expression: "{{ $json.text }}", path: "$json.text" },
    { expression: "{{ $json.tokens }}", path: "$json.tokens" },
  ];

  it("returns everything for an empty query", () => {
    expect(filterVariables(vars, "")).toHaveLength(3);
  });

  it("matches anywhere in the path, case-insensitively", () => {
    expect(filterVariables(vars, "TEX").map((v) => v.path)).toEqual(["$json.text"]);
  });
});

describe("applyCompletion", () => {
  it("replaces the open run and leaves the caret after the insertion", () => {
    const text = "Hi {{ te";
    const result = applyCompletion(text, text.length, { open: 3, query: "te" }, {
      expression: "{{ $json.text }}",
      path: "$json.text",
    });
    expect(result.value).toBe("Hi {{ $json.text }}");
    expect(result.caret).toBe(result.value.length);
  });

  it("keeps whatever followed the caret", () => {
    const text = "Hi {{ te rest";
    const result = applyCompletion(text, 8, { open: 3, query: "te" }, {
      expression: "{{ $json.text }}",
      path: "$json.text",
    });
    expect(result.value).toBe("Hi {{ $json.text }} rest");
  });
});

describe("the expression field in the panel", () => {
  it("opens a picker of the UPSTREAM node's variables when you type {{", () => {
    panel();
    const box = screen.getByLabelText("Body");

    fireEvent.change(box, { target: { value: "{{ " } });

    const options = [...document.querySelectorAll("[data-ff-expression-option]")].map((o) =>
      o.getAttribute("data-ff-expression-option"),
    );
    expect(options).toContain("$json.text");
    expect(options).toContain("$json.tokens");
    expect(options).toContain("$json");
  });

  it("names the upstream node so two sources are distinguishable", () => {
    panel();
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "{{ " } });
    expect(screen.getAllByText("Summarize").length).toBeGreaterThan(0);
  });

  it("narrows as you type", () => {
    panel();
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "{{ tok" } });

    const options = [...document.querySelectorAll("[data-ff-expression-option]")].map((o) =>
      o.getAttribute("data-ff-expression-option"),
    );
    expect(options).toEqual(["$json.tokens"]);
  });

  it("inserts the variable on select", () => {
    const { onChange } = panel();
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "{{ tok" } });

    const option = document.querySelector('[data-ff-expression-option="$json.tokens"]')!;
    fireEvent.mouseDown(option);

    expect(lastBody(onChange)).toBe("{{ $json.tokens }}");
  });

  it("selects with the keyboard", () => {
    const { onChange } = panel();
    const box = screen.getByLabelText("Body");
    fireEvent.change(box, { target: { value: "{{ " } });

    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });

    // ArrowDown moves off `$json` (always first) onto the first real field.
    expect(lastBody(onChange)).toBe("{{ $json.text }}");
  });

  it("closes on Escape without inserting", () => {
    const { onChange } = panel();
    const box = screen.getByLabelText("Body");
    fireEvent.change(box, { target: { value: "{{ " } });
    expect(document.querySelector("[data-ff-expression-menu]")).toBeTruthy();

    fireEvent.keyDown(box, { key: "Escape" });

    expect(document.querySelector("[data-ff-expression-menu]")).toBeNull();
    expect(lastBody(onChange)).toBe("{{ ");
  });

  it("offers ONLY the whole input when the panel has no graph", () => {
    // A panel composed by hand still works; it just cannot be context-aware,
    // and it must not pretend otherwise by inventing fields.
    panel(false);
    fireEvent.change(screen.getByLabelText("Body"), { target: { value: "{{ " } });

    const options = [...document.querySelectorAll("[data-ff-expression-option]")].map((o) =>
      o.getAttribute("data-ff-expression-option"),
    );
    expect(options).toEqual(["$json"]);
  });

  it("shows the grammar reference on demand", () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /reference/i }));

    const help = document.querySelector("[data-ff-expression-help]");
    expect(help).toBeTruthy();
    expect(help!.textContent).toContain("{{ $json.field }}");
    // The part an author would otherwise discover by debugging a dead flow.
    expect(help!.textContent).toMatch(/executor|runFlow/);
  });

  it("keeps typing ordinary text from re-opening the picker", () => {
    panel();
    const box = screen.getByLabelText("Body");
    fireEvent.change(box, { target: { value: "{{ $json.text }} then some prose" } });
    expect(document.querySelector("[data-ff-expression-menu]")).toBeNull();
  });
});
