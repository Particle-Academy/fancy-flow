import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { previewValue } from "../src/registry/RegistryNode";
import { NodeConfigPanel } from "../src/components/NodeConfigPanel";
import type { FlowNode } from "../src/types";

/** A node card must never contain JSON punctuation. */
const hasJson = (s: string) => /[{}[\]"]/.test(s);

describe("node card — summarises, never dumps JSON", () => {
  it("renders an array of objects as their item names, not JSON", () => {
    // The exact case from the bug: a `fields` repeater rendered as
    // `[{"key":"answer",…}]` on the card.
    const out = previewValue([
      { key: "answer", label: "Your answer" },
      { key: "email", label: "Email" },
    ]);
    expect(out).toBe("Your answer, Email");
    expect(hasJson(out)).toBe(false);
  });

  it("caps a long list with +N", () => {
    const out = previewValue([{ label: "a" }, { label: "b" }, { label: "c" }, { label: "d" }]);
    expect(out).toContain("+1");
    expect(hasJson(out)).toBe(false);
  });

  it("renders a plain object as a field count, not JSON", () => {
    expect(previewValue({ a: 1, b: 2, c: 3 })).toBe("3 fields");
    expect(hasJson(previewValue({ deep: { nested: 1 } }))).toBe(false);
  });

  it("passes primitives through and truncates long strings", () => {
    expect(previewValue("hello")).toBe("hello");
    expect(previewValue(42)).toBe("42");
    expect(previewValue(false)).toBe("false");
    expect(previewValue("x".repeat(50)).endsWith("…")).toBe(true);
  });

  it("never emits JSON for any nested shape", () => {
    for (const v of [[{ a: 1 }], { x: { y: 1 } }, [1, 2, 3], {}, [], [["nested"]]]) {
      expect(hasJson(previewValue(v))).toBe(false);
    }
  });
});

describe("NodeConfigPanel — delete lives IN the panel", () => {
  const node = (kind: string): FlowNode =>
    ({ id: "n1", type: kind, position: { x: 0, y: 0 }, data: { kind, label: "X", config: {} } }) as FlowNode;

  it("renders a delete button whenever onDelete is provided and a node is selected", () => {
    const html = renderToStaticMarkup(
      createElement(NodeConfigPanel, { node: node("unknown-kind"), onChange: () => {}, onDelete: () => {} }),
    );
    expect(html).toContain('data-action="delete-node"');
    expect(html).toContain("Delete node");
  });

  it("respects a custom delete label", () => {
    const html = renderToStaticMarkup(
      createElement(NodeConfigPanel, {
        node: node("unknown-kind"),
        onChange: () => {},
        onDelete: () => {},
        deleteLabel: "Remove",
      }),
    );
    expect(html).toContain("Remove");
  });

  it("omits the delete button when onDelete is not wired", () => {
    const html = renderToStaticMarkup(
      createElement(NodeConfigPanel, { node: node("unknown-kind"), onChange: () => {} }),
    );
    expect(html).not.toContain('data-action="delete-node"');
  });

  it("shows no delete button in the empty (no-selection) state", () => {
    const html = renderToStaticMarkup(
      createElement(NodeConfigPanel, { node: null, onChange: () => {}, onDelete: () => {} }),
    );
    expect(html).not.toContain('data-action="delete-node"');
  });
});
