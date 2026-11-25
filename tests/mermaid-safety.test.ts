/**
 * The council's conditions on the Mermaid importer (CC-fancy-0060), as tests.
 *
 * - Imported nodes are display-only: a diagram can never become an executable
 *   workflow by being imported.
 * - Unsupported diagram types are reported and never drawn.
 * - Labels are text, never HTML. Input size and node / edge counts are bounded
 *   and configurable. The parser is hand-written: no eval, no script passthrough.
 * - Anything the importer cannot represent is listed in the report.
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fromMermaid, MERMAID_DEFAULT_LIMITS, type MermaidIssue } from "../src/mermaid";
import { runFlow } from "../src/runtime/run-flow";
import { registerBuiltinKinds } from "../src/registry/builtin";
import type { RunEvent } from "../src/types";

registerBuiltinKinds();

const codes = (issues: MermaidIssue[]) => issues.map((i) => i.code);

describe("imported nodes are display-only", () => {
  const source = [
    "flowchart LR",
    "  start[manual_trigger] --> call[llm_call]",
    "  call --> out[output]",
    "  subgraph lane[terminal_lane]",
    "    run[terminal_run]",
    "  end",
    "  out --> run",
  ].join("\n");

  test("every node is a note, whatever its label or id says", () => {
    const { graph } = fromMermaid(source);
    for (const n of graph!.nodes) {
      expect(n.type).toBe("note");
      expect(n.data.kind).toBe("note");
    }
  });

  test("running the imported graph executes nothing", async () => {
    const { graph } = fromMermaid(source);
    const ran: string[] = [];
    // Executors for every kind the labels name. If an imported node were a
    // real kind, one of these would run.
    const spy = (name: string) => () => {
      ran.push(name);
      return {};
    };
    const executors = Object.fromEntries(
      ["note", "manual_trigger", "llm_call", "output", "terminal_run", "action", "trigger"].map((k) => [k, spy(k)]),
    );
    const events: RunEvent[] = [];
    const result = await runFlow(graph!, executors, (e) => events.push(e));

    expect(ran).toEqual([]);
    expect(result.ok).toBe(true);
    const statuses = events.filter((e) => e.type === "node-status") as Array<{
      nodeId: string;
      status: string;
      text?: string;
    }>;
    // Every node was reached and walked past; none ever ran.
    expect(new Set(statuses.map((s) => s.nodeId))).toEqual(new Set(graph!.nodes.map((n) => n.id)));
    expect(statuses.filter((s) => s.status !== "idle")).toEqual([]);
    // A node with no inbound edge is the one the engine would START from, so
    // that is where "it is an annotation" has to hold on its own. (Downstream
    // nodes report "skipped" first: nothing upstream produced a value.)
    const sources = graph!.nodes.filter((n) => !graph!.edges.some((e) => e.target === n.id));
    expect(sources.length).toBeGreaterThan(1);
    for (const n of sources) {
      expect(statuses.find((s) => s.nodeId === n.id)?.text, n.id).toBe("annotation");
    }
  });

  test("entry nodes chosen by a caller still execute nothing", async () => {
    // The strongest form: ask the engine to START at every imported node.
    const { graph } = fromMermaid(source);
    const ran: string[] = [];
    const executors = Object.fromEntries(
      ["note", "manual_trigger", "llm_call", "output", "terminal_run"].map((k) => [k, () => void ran.push(k)]),
    );
    const result = await runFlow(graph!, executors, () => {}, { entryNodes: graph!.nodes.map((n) => n.id) });
    expect(ran).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("ids that collide with kind names or prototype keys stay plain notes", () => {
    const { graph } = fromMermaid("flowchart LR\n  __proto__ --> constructor\n  toString --> manual_trigger");
    expect(graph!.nodes.map((n) => n.id)).toEqual(["__proto__", "constructor", "toString", "manual_trigger"]);
    expect(graph!.nodes.every((n) => n.type === "note")).toBe(true);
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(graph!.nodes[0].data)).toBe(Object.prototype);
  });
});

describe("diagram types the importer does not support", () => {
  const CASES: Array<[string, string]> = [
    ["sequenceDiagram\n  Alice->>Bob: Hello", "sequence"],
    ["gantt\n  title A plan\n  section S\n  Task :a1, 2024-01-01, 3d", "gantt"],
    ["classDiagram\n  Animal <|-- Duck", "class"],
    ["stateDiagram-v2\n  [*] --> Still", "state"],
    ["erDiagram\n  CUSTOMER ||--o{ ORDER : places", "er"],
    ["pie title Pets\n  \"Dogs\" : 386", "pie"],
    ["journey\n  title My day", "journey"],
    ["gitGraph\n  commit", "git"],
    ["mindmap\n  root((mindmap))", "mindmap"],
    ["timeline\n  title History", "timeline"],
    ["quadrantChart\n  title Reach", "quadrant"],
    ["C4Context\n  title System", "c4"],
    ["xychart-beta\n  title Sales", "xychart"],
    ["somethingNew\n  a b c", "unknown"],
  ];

  test.each(CASES)("%s is reported, not drawn", (source, type) => {
    const { graph, report } = fromMermaid(source);
    expect(graph).toBeNull();
    expect(report.supported).toBe(false);
    expect(report.diagramType).toBe(type);
    expect(codes(report.issues)).toContain("unsupported-diagram");
    expect(report.issues.find((i) => i.code === "unsupported-diagram")!.severity).toBe("error");
  });

  test("a comment or directive before the keyword does not hide the type", () => {
    const { report } = fromMermaid("%% notes\n%%{init: {}}%%\nsequenceDiagram\n  A->>B: hi");
    expect(report.diagramType).toBe("sequence");
    expect(report.supported).toBe(false);
  });

  test("empty input is reported as empty, not as a flowchart", () => {
    for (const source of ["", "   \n\n", "%% only a comment"]) {
      const { graph, report } = fromMermaid(source);
      expect(graph).toBeNull();
      expect(report.diagramType).toBe("empty");
      expect(codes(report.issues)).toContain("empty");
    }
  });
});

describe("nothing is silently dropped", () => {
  const source = [
    "---",
    "title: With front matter",
    "---",
    "%%{init: {\"theme\": \"forest\"}}%%",
    "flowchart LR",
    "  accTitle: Accessible title",
    "  A[One]:::hot --> B",
    "  classDef hot fill:#f96",
    "  class B hot",
    "  style A fill:#f9f",
    "  linkStyle 0 stroke:#ff3",
    "  click A \"https://example.com\"",
    "  click B callback",
    "  C@{ shape: rounded }",
    "  e1@--> D",
  ].join("\n");

  test("every statement it cannot represent is listed, with its line", () => {
    const { graph, report } = fromMermaid(source);
    expect(graph).not.toBeNull();
    const byLine = new Map(report.issues.map((i) => [i.line, i]));
    expect(byLine.get(1)?.code).toBe("frontmatter-ignored");
    expect(byLine.get(4)?.code).toBe("directive-ignored");
    expect(byLine.get(6)?.code).toBe("unsupported-statement");
    expect(byLine.get(7)?.code).toBe("unsupported-statement"); // :::hot
    expect(byLine.get(8)?.code).toBe("unsupported-statement");
    expect(byLine.get(9)?.code).toBe("unsupported-statement");
    expect(byLine.get(10)?.code).toBe("unsupported-statement");
    expect(byLine.get(11)?.code).toBe("unsupported-statement");
    expect(byLine.get(12)?.code).toBe("interaction-ignored");
    expect(byLine.get(13)?.code).toBe("interaction-ignored");
    expect(byLine.get(14)?.code).toBe("unsupported-syntax");
    expect(byLine.get(15)?.code).toBe("unsupported-syntax");
    for (const issue of report.issues) expect(issue.message.length).toBeGreaterThan(10);
  });

  test("a line it could not read makes the result incomplete", () => {
    const { report } = fromMermaid(source);
    expect(report.complete).toBe(false);
    // What it could read is still there.
    expect(fromMermaid(source).graph!.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["A", "B"]));
  });

  test("a style-only statement leaves the result complete but warned", () => {
    const { report } = fromMermaid("flowchart LR\n  A --> B\n  style A fill:#f9f");
    expect(report.complete).toBe(true);
    expect(report.issues.map((i) => i.severity)).toEqual(["warning"]);
  });

  test("an unclosed subgraph and a stray end are reported", () => {
    expect(codes(fromMermaid("flowchart LR\n  subgraph S\n  A").report.issues)).toContain("unclosed-subgraph");
    expect(codes(fromMermaid("flowchart LR\n  A\n  end").report.issues)).toContain("unexpected-end");
  });

  test("an edge to a node it could not read is reported, not invented", () => {
    const { graph, report } = fromMermaid("flowchart LR\n  A --> B[unclosed");
    expect(codes(report.issues)).toContain("parse-error");
    expect(graph!.edges).toEqual([]);
  });
});

describe("labels are text, never HTML", () => {
  test("markup in a label is kept as literal text and reported", () => {
    const { graph, report } = fromMermaid('flowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B["<b>bold</b>"]');
    expect(graph!.nodes[0].data.label).toBe("<img src=x onerror=alert(1)>");
    expect(graph!.nodes[1].data.label).toBe("<b>bold</b>");
    expect(codes(report.issues)).toContain("html-as-text");
  });

  test("an interaction never reaches the graph", () => {
    const { graph } = fromMermaid('flowchart LR\n  A\n  click A "javascript:alert(1)"\n  click A call evil()');
    expect(JSON.stringify(graph)).not.toMatch(/javascript|alert|evil/);
  });

  test("a directive never changes anything", () => {
    const a = fromMermaid("flowchart LR\n  A --> B").graph;
    const b = fromMermaid('%%{init: {"securityLevel": "loose", "flowchart": {"htmlLabels": true}}}%%\nflowchart LR\n  A --> B').graph;
    expect(b).toEqual(a);
  });
});

describe("bounded input", () => {
  test("the defaults are the documented ones", () => {
    expect(MERMAID_DEFAULT_LIMITS).toEqual({
      maxInputLength: 50_000,
      maxNodes: 500,
      maxEdges: 1_000,
      maxLabelLength: 500,
      maxSubgraphDepth: 16,
    });
  });

  test("input over maxInputLength is refused before parsing", () => {
    const source = "flowchart LR\n" + "A --> B\n".repeat(10);
    const { graph, report } = fromMermaid(source, { limits: { maxInputLength: 20 } });
    expect(graph).toBeNull();
    expect(report.issues[0]).toMatchObject({ code: "limit-exceeded", severity: "error" });
    expect(report.issues[0].message).toContain("maxInputLength");
  });

  test("too many nodes is refused, not truncated into a different diagram", () => {
    const source = "flowchart LR\n" + Array.from({ length: 20 }, (_, i) => `n${i}`).join("\n");
    const { graph, report } = fromMermaid(source, { limits: { maxNodes: 10 } });
    expect(graph).toBeNull();
    expect(report.issues.at(-1)).toMatchObject({ code: "limit-exceeded" });
    expect(report.issues.at(-1)!.message).toContain("maxNodes");
  });

  test("too many edges is refused", () => {
    const source = "flowchart LR\n" + Array.from({ length: 20 }, () => "A --> B").join("\n");
    const { graph, report } = fromMermaid(source, { limits: { maxEdges: 5 } });
    expect(graph).toBeNull();
    expect(report.issues.at(-1)!.message).toContain("maxEdges");
  });

  test("subgraph nesting is bounded", () => {
    const depth = 40;
    const source = ["flowchart LR", ...Array.from({ length: depth }, (_, i) => `subgraph s${i}`), "A", ...Array(depth).fill("end")].join("\n");
    const { graph, report } = fromMermaid(source);
    expect(graph).toBeNull();
    expect(report.issues.at(-1)!.message).toContain("maxSubgraphDepth");
  });

  test("an over-long label is shortened and reported", () => {
    const { graph, report } = fromMermaid(`flowchart LR\n  A["${"x".repeat(80)}"]`, { limits: { maxLabelLength: 10 } });
    expect(graph!.nodes[0].data.label).toBe("xxxxxxxxx…");
    expect(codes(report.issues)).toContain("label-truncated");
  });

  test("the default input cap holds against a large paste", () => {
    const { graph, report } = fromMermaid("flowchart LR\n" + "A".repeat(60_000));
    expect(graph).toBeNull();
    expect(report.issues[0].code).toBe("limit-exceeded");
  });
});

describe("hostile input does not throw or hang", () => {
  const HOSTILE: Array<[string, string]> = [
    ["unbalanced brackets", "flowchart LR\n  A[[[[[[[[[[[[[[[[[[[["],
    ["a lone link", "flowchart LR\n  -->"],
    ["a link with no target", "flowchart LR\n  A -->"],
    ["an unterminated quote", 'flowchart LR\n  A["never closed'],
    ["an unterminated pipe label", "flowchart LR\n  A -->|never closed B"],
    ["control characters", "flowchart LR\n  A[\u0000\u0007\u001b[31m] --> B"],
    ["a long run of dashes", "flowchart LR\n  A " + "-".repeat(40_000) + " B"],
    ["a long run of dots", "flowchart LR\n  A -" + ".".repeat(40_000) + " B"],
    ["many ampersands", "flowchart LR\n  " + "A & ".repeat(5_000) + "B"],
    ["a long unquoted label", "flowchart LR\n  A[" + "(".repeat(40_000)],
    ["only semicolons", "flowchart LR\n" + ";".repeat(40_000)],
    ["non-string input", null as unknown as string],
  ];

  test.each(HOSTILE)("%s", (_name, source) => {
    const started = performance.now();
    const result = fromMermaid(source);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(result.report).toBeTruthy();
    expect(Array.isArray(result.report.issues)).toBe(true);
  });

  test("control characters stay inside the label as text", () => {
    const { graph } = fromMermaid('flowchart LR\n  A["\u0007bell"]');
    expect(graph!.nodes[0].data.label).toBe("\u0007bell");
  });
});

describe("the parser is hand-written and inert", () => {
  const DIR = fileURLToPath(new URL("../src/mermaid/", import.meta.url));
  const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));

  test("the module exists and is non-trivial", () => {
    // Guard on the guard: an empty directory would make the scan below vacuous.
    expect(files.length).toBeGreaterThan(0);
    const total = files.reduce((n, f) => n + readFileSync(DIR + f, "utf8").length, 0);
    expect(total).toBeGreaterThan(5_000);
  });

  test.each(files)("%s has no eval, Function, HTML injection or dynamic import", (file) => {
    const src = readFileSync(DIR + file, "utf8");
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/\bnew\s+Function\b|\bFunction\s*\(/);
    expect(src).not.toMatch(/innerHTML|outerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write/);
    expect(src).not.toMatch(/\bimport\s*\(/);
    expect(src).not.toMatch(/from\s+["']react/);
  });
});
