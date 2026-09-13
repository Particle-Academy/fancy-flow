import { describe, expect, it } from "vitest";
import { importWorkflow } from "../src/schema";

/**
 * `lenient` never covers the schema version.
 *
 * It used to. In lenient mode an unsupported version became a warning and the
 * import carried on, in all three runtimes. fancy-flow-php's
 * `FancyFlowManager::toGraph()` imports leniently on every `run()`, so a
 * versionless graph RAN in Laravel while a default import here, which is
 * strict, refused the same document. One document, two answers; the
 * fancy-conformance `flow/connector-runs` manifest recorded the split.
 *
 * `lenient` exists for unknown VOCABULARY: a kind this host has not registered,
 * a config it cannot validate. A version is not vocabulary. A runtime cannot
 * honour a format it does not know, so a document without `version: 1` is
 * refused whichever way it is imported.
 */
const empty = { nodes: [], edges: [] };
const doc = (version: unknown) => ({
  $schema: "https://ui.particle.academy/schemas/fancy-flow/workflow-v1.json",
  ...(version === undefined ? {} : { version }),
  graph: {
    nodes: [{ id: "t", kind: "manual_trigger", position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  },
});

describe("a lenient import refuses a document it cannot read", () => {
  it.each([
    ["no version at all", undefined],
    ["a future version", 2],
    ["the version as a string", "1"],
    ["a boolean", true],
  ])("refuses %s", (_label, version) => {
    const result = importWorkflow(doc(version), { lenient: true });

    expect(result.ok).toBe(false);
    expect(result.graph).toEqual(empty);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.level).toBe("error");
    expect(result.issues[0]!.message).toMatch(/^Unsupported workflow schema version: .* \(expected 1\)$/);
  });

  it("answers exactly as a strict import does", () => {
    const lenient = importWorkflow(doc(undefined), { lenient: true });
    const strict = importWorkflow(doc(undefined));

    expect(lenient).toEqual(strict);
  });
});

describe("lenient still softens what it is for", () => {
  it("imports a version-1 document and turns an unknown kind into a warning", () => {
    const withUnknownKind = {
      ...doc(1),
      graph: {
        nodes: [
          { id: "t", kind: "manual_trigger", position: { x: 0, y: 0 }, config: {} },
          { id: "x", kind: "not_a_registered_kind", position: { x: 200, y: 0 }, config: {} },
        ],
        edges: [{ id: "e", source: "t", target: "x" }],
      },
    };

    const result = importWorkflow(withUnknownKind, { lenient: true });

    expect(result.ok).toBe(true);
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.issues.some((i) => i.level === "warning" && /Unknown kind/.test(i.message))).toBe(true);
    expect(result.issues.some((i) => i.level === "error")).toBe(false);
  });
});

describe("the editor's Import button", () => {
  it("leaves the canvas alone when the import is refused", async () => {
    const { loadImportedWorkflow } = await import("../src/components/FlowEditor/FlowEditor");
    const loaded: unknown[] = [];
    const error = console.error;
    console.error = () => {};

    try {
      // A refused import returns an EMPTY graph; loading it would wipe the canvas.
      expect(loadImportedWorkflow(importWorkflow(doc(undefined), { lenient: true }), (g) => loaded.push(g))).toBe(false);
    } finally {
      console.error = error;
    }

    expect(loaded).toEqual([]);
  });

  it("loads a graph that imported", async () => {
    const { loadImportedWorkflow } = await import("../src/components/FlowEditor/FlowEditor");
    const loaded: unknown[] = [];

    expect(loadImportedWorkflow(importWorkflow(doc(1), { lenient: true }), (g) => loaded.push(g))).toBe(true);
    expect(loaded).toHaveLength(1);
  });

  it("still loads a graph that was read but carries an error, so it can be fixed", async () => {
    const { loadImportedWorkflow } = await import("../src/components/FlowEditor/FlowEditor");
    const loaded: unknown[] = [];
    // Two nodes wired to nothing: a connectivity ERROR, which `lenient` does not
    // soften. The graph was still READ, and the editor is where it gets wired.
    const unwired = {
      ...doc(1),
      graph: {
        nodes: [
          { id: "t", kind: "manual_trigger", position: { x: 0, y: 0 }, config: {} },
          { id: "o", kind: "output", position: { x: 200, y: 0 }, config: {} },
        ],
        edges: [],
      },
    };
    const result = importWorkflow(unwired, { lenient: true });
    expect(result.ok).toBe(false);

    expect(loadImportedWorkflow(result, (g) => loaded.push(g))).toBe(true);
    expect(loaded).toHaveLength(1);
  });
});
