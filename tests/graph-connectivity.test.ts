import { describe, expect, it } from "vitest";
import { importWorkflow, WORKFLOW_SCHEMA_VERSION } from "../src/schema/workflow-schema";
import { registerNodeKind } from "../src/registry/registry";

/**
 * A graph must not contain a node that cannot take part in it — the TS twin of
 * `FancyFlow\Analysis\GraphConnectivity` (fancy-flow-php 0.48).
 *
 * Both refused shapes were MEASURED against the engine before either runtime
 * implemented the rule, and NEITHER of them fails today:
 *
 * - a floating `log` in a three-node graph ran (`t,lonely,o`), disconnected;
 * - `t -> output -> log` imported clean and the `log` ran with `{{ input }}`
 *   resolving to `""`.
 *
 * So these are not "does the validator notice", they are "does the validator
 * notice something the runtime never will".
 */

type RawNode = Record<string, unknown>;

function schema(nodes: RawNode[], edges: RawNode[] = []) {
  return { version: WORKFLOW_SCHEMA_VERSION, graph: { nodes, edges } };
}

function node(id: string, kind: string, extra: RawNode = {}): RawNode {
  return { id, kind, position: { x: 0, y: 0 }, ...extra };
}

function errors(nodes: RawNode[], edges: RawNode[] = []) {
  return importWorkflow(schema(nodes, edges)).issues.filter((i) => i.level === "error");
}

function messages(nodes: RawNode[], edges: RawNode[] = []) {
  return errors(nodes, edges)
    .map((i) => i.message)
    .join("\n");
}

describe("floating nodes", () => {
  it("refuses a node with no inbound and no outbound edge", () => {
    const result = importWorkflow(
      schema(
        [node("t", "manual_trigger"), node("o", "output"), node("lonely", "log")],
        [{ id: "e1", source: "t", target: "o" }],
      ),
    );

    expect(result.ok).toBe(false);
    expect(messages([node("t", "manual_trigger"), node("o", "output"), node("lonely", "log")], [{ id: "e1", source: "t", target: "o" }])).toContain(
      '"lonely" is connected to nothing',
    );
  });

  it("names the floating node so an editor can highlight it", () => {
    const found = errors(
      [node("t", "manual_trigger"), node("o", "output"), node("lonely", "log")],
      [{ id: "e1", source: "t", target: "o" }],
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.nodeId).toBe("lonely");
  });

  it("refuses a trigger that reaches nobody", () => {
    // Outbound-only is the direction people forget: the node fires and the
    // graph never hears it.
    const found = errors(
      [node("t1", "manual_trigger"), node("o", "output"), node("orphan", "webhook_trigger")],
      [{ id: "e1", source: "t1", target: "o" }],
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.nodeId).toBe("orphan");
  });

  it("reports every disconnected node, not just the first", () => {
    // Stopping at the first would make fixing a graph an N-round trip, and an
    // agent authoring one would burn a call per stray node.
    expect(
      errors(
        [node("t", "manual_trigger"), node("o", "output"), node("a", "log"), node("b", "log")],
        [{ id: "e1", source: "t", target: "o" }],
      ),
    ).toHaveLength(2);
  });

  it("allows a disconnected ISLAND, which is two workflows in one document", () => {
    // Each node has an edge, so none of them floats by the letter of the rule.
    // Recorded deliberately: an island is a defensible thing to author, unlike
    // a node nobody wired up.
    expect(
      errors(
        [node("t1", "manual_trigger"), node("o1", "output"), node("t2", "manual_trigger"), node("o2", "output")],
        [
          { id: "e1", source: "t1", target: "o1" },
          { id: "e2", source: "t2", target: "o2" },
        ],
      ),
    ).toEqual([]);
  });
});

describe("what may float", () => {
  it("lets a note float, because a note is an annotation and not a step", () => {
    expect(
      errors(
        [node("t", "manual_trigger"), node("o", "output"), node("sticky", "note", { config: { body: "why" } })],
        [{ id: "e1", source: "t", target: "o" }],
      ),
    ).toEqual([]);
  });

  it("lets a note float under its canonical namespaced id too", () => {
    // A graph saved by a newer editor carries `@particle-academy/note`. Keying
    // the exemption on the bare spelling alone would turn every sticky note
    // into an error the moment it round-tripped.
    expect(
      errors(
        [node("t", "manual_trigger"), node("o", "output"), node("sticky", "@particle-academy/note")],
        [{ id: "e1", source: "t", target: "o" }],
      ),
    ).toEqual([]);
  });

  it("lets a LANE float, which is the whole point of a lane", () => {
    // This is the case that was missed in the PHP twin's first release and
    // shipped as 0.48.1. A swimlane is never wired to anything.
    expect(
      errors(
        [node("t", "manual_trigger"), node("o", "output"), node("swim", "@particle-academy/lane")],
        [{ id: "e1", source: "t", target: "o" }],
      ),
    ).toEqual([]);
  });

  it("lets a HOST kind categorised `annotation` float", () => {
    // PAIRED WITH ITS CONTROL, and the control is the point.
    //
    // Alone, this assertion cannot fail: if registration silently did nothing,
    // `design_note` would be an UNKNOWN kind — and unknown kinds float too. It
    // would pass whether the category rule worked or not.
    //
    // So a second host kind is registered with an ordinary category. Only if
    // THAT one is refused do we know registration took effect and the category
    // is what is doing the work.
    registerNodeKind({ name: "design_note", category: "annotation", label: "Design Note" } as never);
    registerNodeKind({ name: "design_step", category: "data", label: "Design Step" } as never);

    expect(
      errors(
        [node("t", "manual_trigger"), node("o", "output"), node("d", "design_note")],
        [{ id: "e1", source: "t", target: "o" }],
      ),
    ).toEqual([]);

    expect(
      messages(
        [node("t", "manual_trigger"), node("o", "output"), node("s", "design_step")],
        [{ id: "e1", source: "t", target: "o" }],
      ),
    ).toContain("connected to nothing");
  });

  it("does not extend the exemption to an ordinary kind", () => {
    expect(
      messages(
        [node("t", "manual_trigger"), node("o", "output"), node("x", "transform")],
        [{ id: "e1", source: "t", target: "o" }],
      ),
    ).toContain("connected to nothing");
  });

  it("does not ALSO call an unknown kind floating, on top of its own error", () => {
    // We cannot know whether an unknown kind is a step, an annotation or a
    // lane, so claiming it must be wired asserts something unverifiable — and
    // it lands hardest on the graphs that deserve it least.
    const text = messages(
      [node("t", "manual_trigger"), node("o", "output"), node("c", "no_such_kind")],
      [{ id: "e1", source: "t", target: "o" }],
    );

    expect(text).toContain("Unknown kind");
    expect(text).not.toContain("connected to nothing");
  });
});

describe("edges out of a terminator", () => {
  it("refuses an edge whose source is a terminal node", () => {
    const text = messages(
      [node("t", "manual_trigger"), node("out", "output"), node("after", "log")],
      [
        { id: "e1", source: "t", target: "out" },
        { id: "e2", source: "out", target: "after" },
      ],
    );

    expect(text).toContain("is a TERMINAL node");
  });

  it("names the offending EDGE, not the node, so the editor deletes the right thing", () => {
    const found = errors(
      [node("t", "manual_trigger"), node("out", "output"), node("after", "log")],
      [
        { id: "e1", source: "t", target: "out" },
        { id: "e2", source: "out", target: "after" },
      ],
    );

    expect(found).toHaveLength(1);
    expect(found[0]!.edgeId).toBe("e2");
    expect(found[0]!.nodeId).toBeUndefined();
  });

  it("refuses an edge out of `log`, which is terminal too", () => {
    expect(
      messages(
        [node("t", "manual_trigger"), node("l", "log"), node("after", "output")],
        [
          { id: "e1", source: "t", target: "l" },
          { id: "e2", source: "l", target: "after" },
        ],
      ),
    ).toContain("TERMINAL");
  });

  it("allows an edge out of an ordinary node that declares no outputs at all", () => {
    // THE DISTINCTION THIS TURNS ON. `[]` is an explicit "there is nothing to
    // connect from"; `undefined` is "nobody declared it", which resolves to
    // `out` and is most nodes in most graphs.
    expect(
      errors(
        [node("t", "manual_trigger"), node("w", "wait"), node("o", "output")],
        [
          { id: "e1", source: "t", target: "w" },
          { id: "e2", source: "w", target: "o" },
        ],
      ),
    ).toEqual([]);
  });

  it("believes a node that carries its own outputs, over its kind", () => {
    // TS preserves node-level ports on import; the PHP twin drops them. A real
    // divergence between the two importers, recorded here rather than smoothed
    // over — this branch is reachable on this side and not on that one.
    expect(
      errors(
        [node("t", "manual_trigger"), node("out", "output", { outputs: [{ id: "done" }] }), node("after", "log")],
        [
          { id: "e1", source: "t", target: "out" },
          { id: "e2", source: "out", target: "after" },
        ],
      ),
    ).toEqual([]);
  });

  it("does not refuse an edge from a kind it has never heard of", () => {
    // An unregistered kind falls back to `out` in the engine, so it is not a
    // terminator. Using "I do not know" as evidence is the failure this suite
    // keeps finding elsewhere.
    expect(
      messages(
        [node("t", "manual_trigger"), node("x", "some_host_kind"), node("o", "output")],
        [
          { id: "e1", source: "t", target: "x" },
          { id: "e2", source: "x", target: "o" },
        ],
      ),
    ).not.toContain("TERMINAL");
  });
});

describe("the graphs people actually write still pass", () => {
  it("passes an ordinary linear workflow", () => {
    expect(
      errors(
        [
          node("t", "manual_trigger"),
          node("h", "api_request", { config: { url: "https://example.test" } }),
          node("x", "transform"),
          node("o", "output"),
        ],
        [
          { id: "e1", source: "t", target: "h" },
          { id: "e2", source: "h", target: "x" },
          { id: "e3", source: "x", target: "o" },
        ],
      ),
    ).toEqual([]);
  });

  it("passes a branch with two terminal ends", () => {
    expect(
      errors(
        [node("t", "manual_trigger"), node("b", "branch", { config: { condition: "input.ok" } }), node("yes", "output"), node("no", "log")],
        [
          { id: "e1", source: "t", target: "b" },
          { id: "e2", source: "b", target: "yes", sourceHandle: "true" },
          { id: "e3", source: "b", target: "no", sourceHandle: "false" },
        ],
      ),
    ).toEqual([]);
  });

  it("passes a single-node graph, which is a small workflow and not a floating node", () => {
    // Refusing this would make the editor unusable from the first node placed.
    expect(errors([node("t", "manual_trigger")])).toEqual([]);
  });

  it("passes an empty graph", () => {
    expect(errors([])).toEqual([]);
  });

  it("still only WARNS about a dangling edge, and does not then call the node floating", () => {
    // A dangling edge is dropped with a warning by the importer. Running
    // connectivity on the surviving edges alone would strand its source and
    // turn one warning into an error — changing an existing, documented
    // behaviour as a side effect.
    const result = importWorkflow(
      schema(
        [node("t", "manual_trigger"), node("o", "output")],
        [
          { id: "e1", source: "t", target: "o" },
          { id: "e2", source: "t", target: "ghost" },
        ],
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.level === "warning")).toHaveLength(1);
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("is lenient-mode independent — a broken graph is broken either way", () => {
    // `lenient` is about unknown VOCABULARY, never about wiring.
    const result = importWorkflow(
      schema(
        [node("t", "manual_trigger"), node("o", "output"), node("lonely", "log")],
        [{ id: "e1", source: "t", target: "o" }],
      ),
      { lenient: true },
    );

    expect(result.ok).toBe(false);
  });
});
