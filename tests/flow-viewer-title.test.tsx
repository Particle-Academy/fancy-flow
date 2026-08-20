/**
 * A node's own `data.label` is the name the AUTHOR gave that node. It must beat
 * the kind's generic type name.
 *
 * The title chain read `kind?.label ?? node.data?.label ?? node.data?.kind`, so
 * the registry label won: a graph whose nodes were deliberately named "Fetch
 * order", "Summarize" and "Respond" listed as "API Request", "LLM Call" and
 * "Output" — three generic type names where three specific ones were written,
 * and every `llm_call` in a flow rendering as the same word.
 *
 * The ordering also disguised the empty-registry bug next door: an UNREGISTERED
 * kind fell through to `data.label` and looked perfect, while a registered one
 * showed the generic name and an unregistered one with no label showed a raw
 * `@particle-academy/…` id. Same chain, three different-looking outcomes.
 */
import React from "react";
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FlowViewer } from "../src/components/FlowViewer/FlowViewer";

const graph = {
  nodes: [
    { id: "s", type: "llm_call", position: { x: 0, y: 0 }, data: { kind: "llm_call", label: "Summarize" } },
    { id: "u", type: "llm_call", position: { x: 0, y: 60 }, data: { kind: "llm_call" } },
    { id: "x", type: "@acme/unknown", position: { x: 0, y: 120 }, data: { kind: "@acme/unknown", label: "Custom step" } },
  ],
  edges: [],
} as never;

describe("FlowViewer titles", () => {
  const html = renderToStaticMarkup(<FlowViewer graph={graph} variant="list" />);

  test("the author's node label wins over the kind's generic label", () => {
    expect(html).toContain("Summarize");
  });

  test("a node with no label of its own still gets the kind's name", () => {
    expect(html).toContain("LLM Call");
  });

  test("an unregistered kind with a label shows the label, not the raw id", () => {
    expect(html).toContain("Custom step");
    expect(html).not.toContain("@acme/unknown");
  });
});
