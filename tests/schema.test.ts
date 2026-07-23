import { describe, it, expect } from "vitest";
import { exportWorkflow, importWorkflow, migrateSchema } from "../src/schema";
import type { FlowGraph } from "../src/types";

describe("schema layout persistence (0.21)", () => {
  it("round-trips parentId / extent / width / height / style through export → import", () => {
    const graph: FlowGraph = {
      nodes: [
        {
          id: "lane",
          type: "lane",
          position: { x: 0, y: 0 },
          width: 600,
          height: 200,
          style: { zIndex: -1 },
          data: { kind: "lane", label: "Lane" },
        } as any,
        {
          id: "a",
          type: "action",
          position: { x: 20, y: 20 },
          parentId: "lane",
          extent: "parent",
          data: { kind: "action", label: "A" },
        } as any,
      ],
      edges: [],
    };

    const schema = exportWorkflow(graph);
    const laneOut = schema.graph.nodes.find((n) => n.id === "lane")!;
    expect(laneOut.width).toBe(600);
    expect(laneOut.height).toBe(200);
    expect(laneOut.style).toEqual({ zIndex: -1 });
    const childOut = schema.graph.nodes.find((n) => n.id === "a")!;
    expect(childOut.parentId).toBe("lane");
    expect(childOut.extent).toBe("parent");

    const { graph: back } = importWorkflow(schema, { lenient: true });
    const laneBack = back.nodes.find((n) => n.id === "lane")! as any;
    expect(laneBack.width).toBe(600);
    expect(laneBack.height).toBe(200);
    expect(laneBack.style).toEqual({ zIndex: -1 });
    const childBack = back.nodes.find((n) => n.id === "a")! as any;
    expect(childBack.parentId).toBe("lane");
    expect(childBack.extent).toBe("parent");
  });

  it("does not emit layout fields for a node that has none (no bloat)", () => {
    const graph: FlowGraph = {
      nodes: [{ id: "a", type: "action", position: { x: 0, y: 0 }, data: { kind: "action", label: "A" } } as any],
      edges: [],
    };
    const node = exportWorkflow(graph).graph.nodes[0];
    expect(node.parentId).toBeUndefined();
    expect(node.width).toBeUndefined();
    expect(node.height).toBeUndefined();
    expect(node.style).toBeUndefined();
  });

  it("migrateSchema is a v1 passthrough seam", () => {
    const s = { version: 1, graph: { nodes: [], edges: [] } };
    expect(migrateSchema(s)).toBe(s);
    expect(importWorkflow(s as any).ok).toBe(true);
  });
});
