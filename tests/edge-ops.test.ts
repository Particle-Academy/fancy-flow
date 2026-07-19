import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import { removeEdges, setEdgeLabel } from "../src/components/FlowEditor/graph-ops";
import { normalizeChoices } from "../src/components/NodeConfigPanel/ConfigFieldRenderer";

const edges: Edge[] = [
  { id: "e1", source: "a", target: "b" },
  { id: "e2", source: "b", target: "c", label: "existing" },
];

describe("removeEdges — breaking connections", () => {
  it("breaks the named connection and leaves the rest", () => {
    expect(removeEdges(edges, ["e1"]).map((e) => e.id)).toEqual(["e2"]);
  });

  it("leaves both endpoints' other connections intact", () => {
    const next = removeEdges(edges, ["e1"]);
    expect(next.find((e) => e.id === "e2")).toBeDefined();
  });

  it("is a no-op for an unknown id", () => {
    expect(removeEdges(edges, ["nope"])).toHaveLength(2);
  });

  it("does not mutate the input array", () => {
    removeEdges(edges, ["e1"]);
    expect(edges).toHaveLength(2);
  });
});

describe("setEdgeLabel — labelling connections", () => {
  it("labels the target edge only", () => {
    const next = setEdgeLabel(edges, "e1", "approved");
    expect(next.find((e) => e.id === "e1")?.label).toBe("approved");
    expect(next.find((e) => e.id === "e2")?.label).toBe("existing");
  });

  it("replaces an existing label", () => {
    expect(setEdgeLabel(edges, "e2", "rejected").find((e) => e.id === "e2")?.label).toBe("rejected");
  });

  it("trims surrounding whitespace", () => {
    expect(setEdgeLabel(edges, "e1", "  spaced  ").find((e) => e.id === "e1")?.label).toBe("spaced");
  });

  it("removes the key entirely when cleared, rather than storing an empty string", () => {
    // An empty label renders as a blank chip on the wire and would survive
    // export into the workflow schema as a meaningless key.
    const next = setEdgeLabel(edges, "e2", "");
    expect("label" in next.find((e) => e.id === "e2")!).toBe(false);
  });

  it("treats a whitespace-only label as clearing", () => {
    expect("label" in setEdgeLabel(edges, "e2", "   ").find((e) => e.id === "e2")!).toBe(false);
  });

  it("clears on undefined", () => {
    expect("label" in setEdgeLabel(edges, "e2", undefined).find((e) => e.id === "e2")!).toBe(false);
  });

  it("does not mutate the input edges", () => {
    setEdgeLabel(edges, "e2", "changed");
    expect(edges.find((e) => e.id === "e2")?.label).toBe("existing");
  });
});

describe("text field choices", () => {
  it("expands bare-string shorthand to value/label pairs", () => {
    expect(normalizeChoices(["a", "b"])).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
    ]);
  });

  it("defaults a missing label to the value", () => {
    expect(normalizeChoices([{ value: "x" }])).toEqual([{ value: "x", label: "x" }]);
  });

  it("keeps an explicit label", () => {
    expect(normalizeChoices([{ value: "x", label: "Ex" }])).toEqual([{ value: "x", label: "Ex" }]);
  });

  it("handles the mixed form", () => {
    expect(normalizeChoices(["a", { value: "b", label: "Bee" }])).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "Bee" },
    ]);
  });
});
