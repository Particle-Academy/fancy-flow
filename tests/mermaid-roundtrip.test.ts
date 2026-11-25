/**
 * Mermaid -> graph -> Mermaid, for every fixture in tests/fixtures/mermaid.
 *
 * Each fixture is a pair: `<name>.in.mmd` is Mermaid as a person or an agent
 * writes it (shorthand, unquoted labels, `graph TD`, semicolons, comments), and
 * `<name>.out.mmd` is the canonical form `toMermaid` writes back.
 *
 * Three properties per fixture, because any one alone can pass while the
 * round trip is broken:
 *
 * 1. `toMermaid(fromMermaid(in))` is exactly `out`, so the writer is pinned.
 * 2. `fromMermaid(out)` means the same graph as `fromMermaid(in)`: same nodes,
 *    labels, shapes, nesting and edges. Without this, (1) could pass with a
 *    writer that emits text the reader then understands differently.
 * 3. `out` is a fixed point: writing it again changes nothing.
 *
 * A fixture whose import reported a warning or an error is a broken fixture,
 * not a passing one, so every fixture must also import cleanly.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fromMermaid, toMermaid, type MermaidImportResult } from "../src/mermaid";
import type { FlowGraph } from "../src/types";

const DIR = fileURLToPath(new URL("./fixtures/mermaid/", import.meta.url));
const names = readdirSync(DIR)
  .filter((f) => f.endsWith(".in.mmd"))
  .map((f) => f.slice(0, -".in.mmd".length))
  .sort();

// Normalised: with core.autocrlf a Windows checkout writes these with CRLF,
// and the canonical form `toMermaid` writes uses LF.
const read = (file: string) => readFileSync(DIR + file, "utf8").replace(/\r\n/g, "\n");

/** What a graph MEANS, independent of order, ids of edges and layout. */
function meaning(graph: FlowGraph | null) {
  expect(graph).not.toBeNull();
  const nodes = graph!.nodes
    .map((n) => {
      const m = (n.data as any).mermaid;
      return JSON.stringify({
        id: n.id,
        label: n.data.label,
        shape: m.shape,
        subgraph: Boolean(m.subgraph),
        direction: m.direction ?? null,
        parent: (n as any).parentId ?? null,
      });
    })
    .sort();
  const edges = graph!.edges
    .map((e) => {
      const m = (e.data as any).mermaid;
      return JSON.stringify({
        source: e.source,
        target: e.target,
        label: e.label ?? null,
        stroke: m.stroke,
        head: m.head,
        tail: m.tail,
        length: m.length,
      });
    })
    .sort();
  return { nodes, edges };
}

function clean(result: MermaidImportResult) {
  const loud = result.report.issues.filter((i) => i.severity !== "info");
  expect(loud, JSON.stringify(loud, null, 2)).toEqual([]);
  expect(result.report.supported).toBe(true);
  expect(result.report.complete).toBe(true);
}

describe("Mermaid round trip fixtures", () => {
  test("the fixture set is really there", () => {
    // A glob that matched nothing would make every property below vacuous.
    expect(names).toEqual(["basic", "comments", "edges", "labels", "shapes", "subgraphs"]);
  });

  describe.each(names)("%s", (name) => {
    const input = read(`${name}.in.mmd`);
    const canonical = read(`${name}.out.mmd`);

    test("imports cleanly", () => {
      clean(fromMermaid(input));
      clean(fromMermaid(canonical));
    });

    test("writes back the canonical form", () => {
      expect(toMermaid(fromMermaid(input).graph!)).toBe(canonical);
    });

    test("the canonical form means the same graph", () => {
      expect(meaning(fromMermaid(canonical).graph)).toEqual(meaning(fromMermaid(input).graph));
    });

    test("the canonical form is a fixed point", () => {
      expect(toMermaid(fromMermaid(canonical).graph!)).toBe(canonical);
    });
  });
});

describe("what the importer reads", () => {
  test("directions: TD is TB, and the direction rides on the graph", () => {
    expect(fromMermaid("graph TD\nA").report.direction).toBe("TB");
    expect(fromMermaid("flowchart BT\nA").report.direction).toBe("BT");
    expect(fromMermaid("flowchart\nA").report.direction).toBe("TB");
    expect(fromMermaid("flowchart LR\nA").graph!.mermaid?.direction).toBe("LR");
  });

  test("shapes", () => {
    const { graph } = fromMermaid(read("shapes.in.mmd"));
    const shape = (id: string) => (graph!.nodes.find((n) => n.id === id)!.data as any).mermaid.shape;
    expect(
      ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9", "b1", "b2", "b3", "b4", "b5", "b6"].map(shape),
    ).toEqual([
      "rect", "round", "stadium", "subroutine", "cylinder", "circle", "asymmetric", "diamond",
      "hexagon", "parallelogram", "parallelogram-alt", "trapezoid", "trapezoid-alt", "double-circle", "rect",
    ]);
  });

  test("edge strokes, heads and labels", () => {
    const { graph } = fromMermaid(read("edges.in.mmd"));
    const to = (target: string) => graph!.edges.find((e) => e.target === target)!;
    const m = (target: string) => (to(target).data as any).mermaid;
    expect(m("B")).toEqual({ stroke: "normal", head: "arrow", tail: "none", length: 1 });
    expect(m("C")).toEqual({ stroke: "normal", head: "none", tail: "none", length: 1 });
    expect(m("D").stroke).toBe("dotted");
    expect(m("F").stroke).toBe("thick");
    expect(m("H").head).toBe("circle");
    expect(m("I").head).toBe("cross");
    expect(m("J")).toMatchObject({ head: "arrow", tail: "arrow" });
    expect(m("Q").stroke).toBe("invisible");
    expect(m("R").length).toBe(2);
    expect(to("M").label).toBe("label text");
    expect(to("N").label).toBe("dotted label");
    expect(to("O").label).toBe("thick label");
    expect(to("P").label).toBe("pipe label");
  });

  test("labels are text: <br> is a line break, entities decode, nothing is HTML", () => {
    const { graph } = fromMermaid(read("labels.in.mmd"));
    const label = (id: string) => graph!.nodes.find((n) => n.id === id)!.data.label;
    expect(label("B")).toBe("Line one\nLine two");
    expect(label("C")).toBe('He said "hi"');
    expect(label("D")).toBe("Café ünïcødé 日本");
    expect(graph!.edges.at(-1)!.label).toBe('edge "q" | bar');
  });

  test("subgraphs nest with parentId and keep their own direction", () => {
    const { graph, report } = fromMermaid(read("subgraphs.in.mmd"));
    const node = (id: string) => graph!.nodes.find((n) => n.id === id)! as any;
    expect(node("a1").parentId).toBe("one");
    // First mentioned at top level, then inside `one`: it belongs to `one`.
    expect(node("a2").parentId).toBe("one");
    expect(node("c1").parentId).toBeUndefined();
    expect(node("inner").parentId).toBe("two");
    expect(node("b3").parentId).toBe("inner");
    expect(node("two").data.mermaid).toMatchObject({ subgraph: true, direction: "LR" });
    expect(node("two").data.label).toBe("Second stage");
    expect(node("subgraph1").data.label).toBe("Quoted title");
    expect(report.subgraphCount).toBe(4);
  });

  test("every imported node is laid out, sized, and parents precede children", () => {
    const { graph } = fromMermaid(read("subgraphs.in.mmd"));
    const seen = new Set<string>();
    for (const n of graph!.nodes as any[]) {
      expect(Number.isFinite(n.position.x) && Number.isFinite(n.position.y)).toBe(true);
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
      if (n.parentId) expect(seen.has(n.parentId), `${n.id} before its parent`).toBe(true);
      seen.add(n.id);
    }
  });

  test("the report counts what it drew", () => {
    const { report } = fromMermaid(read("edges.in.mmd"));
    expect(report).toMatchObject({ diagramType: "flowchart", supported: true, nodeCount: 26, edgeCount: 23 });
  });
});

describe("what the exporter writes for a graph it did not import", () => {
  test("a workflow graph exports with its labels and safe ids", () => {
    const graph = {
      nodes: [
        { id: "fetch-order", type: "api_request", position: { x: 0, y: 0 }, data: { kind: "api_request", label: "Fetch order" } },
        { id: "sum 1", type: "llm_call", position: { x: 0, y: 0 }, data: { kind: "llm_call" } },
      ],
      edges: [{ id: "e", source: "fetch-order", target: "sum 1" }],
    } as unknown as FlowGraph;
    expect(toMermaid(graph, { direction: "LR" })).toBe(
      ['flowchart LR', '  fetch-order["Fetch order"]', '  sum_1["llm_call"]', "  fetch-order --> sum_1", ""].join("\n"),
    );
  });
});

describe("the AGENTS.md example", () => {
  test("produces exactly what the guide says it does", () => {
    const { graph, report } = fromMermaid("flowchart LR\n  A[Start] -->|go| B{Ready?}");
    expect(report).toMatchObject({ diagramType: "flowchart", supported: true, complete: true, nodeCount: 2, edgeCount: 1 });
    expect(toMermaid(graph!)).toBe('flowchart LR\n  A["Start"]\n  B{"Ready?"}\n  A -->|"go"| B\n');
  });
});
