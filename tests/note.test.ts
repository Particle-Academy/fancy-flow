import { describe, expect, it, beforeAll } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import { registerBuiltinKinds, getNodeKind, resolveKindId } from "../src/registry";
import { exportWorkflow, importWorkflow } from "../src/schema";
import type { ExecutorRegistry, FlowGraph, RunEvent } from "../src/types";

beforeAll(() => registerBuiltinKinds());

describe("note kind", () => {
  it("is registered under the annotation category, portless, with aliases", () => {
    const kind = getNodeKind("@particle-academy/note");
    expect(kind).not.toBeNull();
    expect(kind!.category).toBe("annotation");
    expect(kind!.inputs).toEqual([]);
    expect(kind!.outputs).toEqual([]);
    // Legacy + short ids resolve to the canonical name.
    expect(resolveKindId("note")).toBe("@particle-academy/note");
    expect(resolveKindId("@fancy/note")).toBe("@particle-academy/note");
  });
});

describe("runFlow — notes never reach a runner", () => {
  it("skips a note with no executor without breaking the run", async () => {
    // trigger → output, plus a floating note. No executor is registered for
    // `note`; if the engine tried to run it, it would error "No executor
    // registered" and halt. The run staying ok proves the note is skipped.
    const graph: FlowGraph = {
      nodes: [
        { id: "t", type: "manual_trigger", position: { x: 0, y: 0 }, data: { kind: "manual_trigger" } },
        { id: "o", type: "output", position: { x: 200, y: 0 }, data: { kind: "output" } },
        { id: "n", type: "note", position: { x: 0, y: 120 }, data: { kind: "note", config: { text: "Explains the flow" } } },
      ] as FlowGraph["nodes"],
      edges: [{ id: "e1", source: "t", target: "o" }] as FlowGraph["edges"],
    };

    const ran: string[] = [];
    const executors: ExecutorRegistry = {
      manual_trigger: () => ({ ok: true }),
      output: ({ node }) => { ran.push(node.id); return { done: true }; },
    };

    const events: RunEvent[] = [];
    const result = await runFlow(graph, executors, (e) => events.push(e));

    expect(result.ok).toBe(true);
    expect(result.error).toBeFalsy();
    expect(ran).toEqual(["o"]); // the note never ran
    // the note is reported as a visual annotation, not an execution
    const noteStatus = events.find((e) => e.type === "node-status" && (e as any).nodeId === "n") as any;
    expect(noteStatus?.text).toBe("annotation");
  });

  it("also skips the canonical @particle-academy/note type", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "n", type: "@particle-academy/note", position: { x: 0, y: 0 }, data: { kind: "@particle-academy/note", config: { text: "hi" } } },
      ] as FlowGraph["nodes"],
      edges: [] as FlowGraph["edges"],
    };
    const result = await runFlow(graph, {});
    expect(result.ok).toBe(true);
  });
});

describe("note schema round-trip", () => {
  it("preserves a note's title / text / color and its resized dimensions", () => {
    const graph: FlowGraph = {
      nodes: [
        {
          id: "n",
          type: "@particle-academy/note",
          position: { x: 40, y: 60 },
          width: 260,
          height: 140,
          data: { kind: "@particle-academy/note", label: "Note", config: { title: "Step 1", text: "Fetch the order.", color: "sky" } },
        },
      ] as FlowGraph["nodes"],
      edges: [] as FlowGraph["edges"],
    };

    const schema = exportWorkflow(graph);
    const round = importWorkflow(schema);
    expect(round.ok).toBe(true);

    const n = round.graph.nodes[0] as any;
    expect(n.type).toBe("@particle-academy/note");
    expect(n.data.config).toMatchObject({ title: "Step 1", text: "Fetch the order.", color: "sky" });
    expect(n.width).toBe(260);
    expect(n.height).toBe(140);
    // portless — no phantom ports written on export
    const exported = schema.graph.nodes[0];
    expect(exported.inputs ?? []).toEqual([]);
    expect(exported.outputs ?? []).toEqual([]);
  });
});
