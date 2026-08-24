/**
 * Per-node STATUS MESSAGES — a workflow narrating itself to a human.
 *
 * A node may carry `startingMsg` / `stoppingMsg` in its data. When present, the
 * engine announces them around that node's execution: "Starting the deep
 * analysis" before an expensive LLM step, "Analysis complete" once it lands.
 * The next node says "Saving report" and the run finishes as it always did.
 *
 * Two properties make this worth having, and both are tested here rather than
 * assumed:
 *
 * 1. **It is opt-in per node.** A node with neither field announces nothing.
 *    Most nodes in a real graph are plumbing, and narrating every one of them
 *    would bury the three steps a human actually cares about.
 *
 * 2. **It is NARRATION, not diagnostics.** These arrive as their own event
 *    type rather than in `node-status.text`, which already carries "skipped",
 *    "resumed", "lane", "annotation" and raw error strings. A consumer building
 *    a progress feed cannot be asked to guess which of those are addressed to a
 *    person; conflating the two is how an error message ends up rendered to a
 *    user as though it were a status update.
 *
 * The sharpest rule below is that `stoppingMsg` does NOT fire when the node
 * throws. "Analysis complete" printed after a crash is not a cosmetic problem —
 * it is the run telling a human the opposite of what happened.
 */
import { describe, expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import type { RunEvent } from "../src/types";

type Node = Record<string, unknown>;

const graph = (nodes: Node[], edges: Record<string, unknown>[] = []) =>
  ({ nodes, edges }) as never;

/** Run and return the event stream. */
async function runCapturing(
  nodes: Node[],
  executors: Record<string, unknown>,
  edges: Record<string, unknown>[] = [],
  options?: Record<string, unknown>,
) {
  const events: RunEvent[] = [];
  const result = await runFlow(
    graph(nodes, edges),
    executors as never,
    (e) => events.push(e),
    options as never,
  );
  return { events, result };
}

/** Just the narration, in order, as `phase:message`. */
const narration = (events: RunEvent[]) =>
  events
    .filter((e): e is Extract<RunEvent, { type: "node-message" }> => e.type === "node-message")
    .map((e) => `${e.phase}:${e.message}`);

describe("node status messages", () => {
  test("announces the start before the node runs and the end after it finishes", async () => {
    const seen: string[] = [];
    const { events } = await runCapturing(
      [{ id: "a", type: "analyse", data: { startingMsg: "Starting the deep analysis", stoppingMsg: "Analysis complete" } }],
      { analyse: () => { seen.push("executed"); return 1; } },
    );

    expect(narration(events)).toEqual([
      "start:Starting the deep analysis",
      "end:Analysis complete",
    ]);

    // Ordering is the whole point: the start must reach a consumer BEFORE the
    // work happens, or it is a receipt rather than a progress message.
    const kinds = events
      .filter((e) => e.type === "node-message" || e.type === "node-status")
      .map((e) => (e.type === "node-message" ? `msg:${e.phase}` : `status:${e.status}`));
    expect(kinds.indexOf("msg:start")).toBeLessThan(kinds.indexOf("msg:end"));
    expect(seen).toEqual(["executed"]);
  });

  test("carries the node id, so a UI can put the message on the right node", async () => {
    const { events } = await runCapturing(
      [{ id: "reporter", type: "save", data: { startingMsg: "Saving report" } }],
      { save: () => "saved" },
    );

    const msgs = events.filter((e) => e.type === "node-message");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ nodeId: "reporter", phase: "start", message: "Saving report" });
  });

  test("a node with neither field announces nothing", async () => {
    // Opt-in is the feature. Most nodes are plumbing.
    const { events, result } = await runCapturing(
      [{ id: "quiet", type: "step", data: {} }, { id: "bare", type: "step" }],
      { step: () => 1 },
    );

    expect(narration(events)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("either field works alone", async () => {
    const startOnly = await runCapturing(
      [{ id: "a", type: "s", data: { startingMsg: "Beginning" } }],
      { s: () => 1 },
    );
    const endOnly = await runCapturing(
      [{ id: "a", type: "s", data: { stoppingMsg: "Finished" } }],
      { s: () => 1 },
    );

    expect(narration(startOnly.events)).toEqual(["start:Beginning"]);
    expect(narration(endOnly.events)).toEqual(["end:Finished"]);
  });

  test("DOES NOT announce completion when the node throws", async () => {
    // The one that matters. A stoppingMsg of "Analysis complete" emitted after
    // a failure tells a human the opposite of what happened, and it would do so
    // in the most trusted part of the UI.
    const { events, result } = await runCapturing(
      [{ id: "a", type: "boom", data: { startingMsg: "Starting the deep analysis", stoppingMsg: "Analysis complete" } }],
      { boom: () => { throw new Error("model refused"); } },
    );

    expect(result.ok).toBe(false);
    expect(narration(events)).toEqual(["start:Starting the deep analysis"]);
    // The failure is still reported through the channel that exists for it.
    expect(events.some((e) => e.type === "node-status" && e.status === "error")).toBe(true);
  });

  test("says nothing for a node that was skipped", async () => {
    // A dead branch never fired, so announcing it would describe work that did
    // not happen.
    const nodes = [
      { id: "d", type: "decide", data: {} },
      { id: "taken", type: "step", data: { startingMsg: "Taken ran" } },
      { id: "dead", type: "step", data: { startingMsg: "Dead ran", stoppingMsg: "Dead finished" } },
    ];
    const edges = [
      { id: "e1", source: "d", sourceHandle: "yes", target: "taken" },
      { id: "e2", source: "d", sourceHandle: "no", target: "dead" },
    ];
    const { events } = await runCapturing(nodes, {
      decide: () => ({ branch: "yes", value: true }),
      step: () => 1,
    }, edges);

    expect(narration(events)).toEqual(["start:Taken ran"]);
  });

  test("says nothing when a node is republished on resume", async () => {
    // A checkpointed node is republished, never re-executed. It already
    // announced itself on the run that first executed it; announcing again on
    // every resume would narrate work nobody redid.
    const { events } = await runCapturing(
      [{ id: "a", type: "s", data: { startingMsg: "Starting", stoppingMsg: "Done" } }],
      { s: () => { throw new Error("must not execute on resume"); } },
      [],
      { resumeOutputs: { a: 42 } },
    );

    expect(narration(events)).toEqual([]);
    expect(events.some((e) => e.type === "node-status" && e.text === "resumed")).toBe(true);
  });

  test("ignores a message that is not a non-empty string", async () => {
    // Graphs are authored by agents and by hand. An empty string is the shape
    // a cleared editor field takes, and emitting it would render a blank line
    // into a progress feed with no way to tell it from a real message.
    const { events } = await runCapturing(
      [
        { id: "a", type: "s", data: { startingMsg: "", stoppingMsg: "   " } },
        { id: "b", type: "s", data: { startingMsg: 42, stoppingMsg: null } },
      ],
      { s: () => 1 },
    );

    expect(narration(events)).toEqual([]);
  });

  test("narration is separate from node-status text, not folded into it", async () => {
    // node-status.text already means "skipped" / "resumed" / "lane" / an error
    // string. If narration landed there too, a consumer could not tell a
    // human-facing announcement from a diagnostic.
    const { events } = await runCapturing(
      [{ id: "a", type: "s", data: { startingMsg: "Hello", stoppingMsg: "Bye" } }],
      { s: () => 1 },
    );

    const statusText = events
      .filter((e): e is Extract<RunEvent, { type: "node-status" }> => e.type === "node-status")
      .map((e) => e.text)
      .filter(Boolean);
    expect(statusText).not.toContain("Hello");
    expect(statusText).not.toContain("Bye");
  });

  test("narrates a multi-node run in execution order", async () => {
    // The example this was built for: analyse, then save.
    const nodes = [
      { id: "a", type: "analyse", data: { startingMsg: "Starting the deep analysis", stoppingMsg: "Analysis complete" } },
      { id: "b", type: "save", data: { startingMsg: "Saving report" } },
    ];
    const edges = [{ id: "e1", source: "a", target: "b" }];
    const { events, result } = await runCapturing(nodes, {
      analyse: () => "findings",
      save: () => "written",
    }, edges);

    expect(result.ok).toBe(true);
    expect(narration(events)).toEqual([
      "start:Starting the deep analysis",
      "end:Analysis complete",
      "start:Saving report",
    ]);
  });
});

/**
 * The document has to CARRY the messages, or the feature is decorative.
 *
 * `toWorkflowSchema` / `fromWorkflowSchema` whitelist node fields by name
 * rather than spreading `data`, which is the right call — it is what keeps a
 * saved graph from accumulating a host's private junk. It also means a new
 * field that nobody adds to both directions is silently dropped the first time
 * a graph is saved and reopened, and nothing anywhere reports it.
 */
describe("status messages survive the document round-trip", () => {
  test("a saved and reopened graph still announces itself", async () => {
    const { exportWorkflow, importWorkflow } = await import("../src/schema/workflow-schema");

    const original = {
      nodes: [{
        id: "a",
        type: "manual_trigger",
        position: { x: 0, y: 0 },
        data: {
          kind: "manual_trigger",
          label: "Analyse",
          startingMsg: "Starting the deep analysis",
          stoppingMsg: "Analysis complete",
        },
      }],
      edges: [],
    } as never;

    const doc = exportWorkflow(original);
    expect(doc.graph.nodes[0].startingMsg, "must be written into the document").toBe("Starting the deep analysis");
    expect(doc.graph.nodes[0].stoppingMsg).toBe("Analysis complete");

    const imported = importWorkflow(JSON.parse(JSON.stringify(doc)));
    expect(imported.ok).toBe(true);
    const reopened = imported.graph;
    expect(reopened.nodes[0].data.startingMsg, "must come back off the document").toBe("Starting the deep analysis");
    expect(reopened.nodes[0].data.stoppingMsg).toBe("Analysis complete");

    // And it must still narrate after the round trip, which is the property a
    // consumer actually depends on.
    const events: RunEvent[] = [];
    await runFlow(reopened as never, { "@particle-academy/manual_trigger": () => 1 } as never, (e) => events.push(e));
    expect(narration(events)).toEqual([
      "start:Starting the deep analysis",
      "end:Analysis complete",
    ]);
  });

  test("a node that declared none stays clean in the document", async () => {
    const { exportWorkflow } = await import("../src/schema/workflow-schema");
    const doc = exportWorkflow({
      nodes: [{ id: "a", type: "manual_trigger", position: { x: 0, y: 0 }, data: { kind: "manual_trigger", label: "Plain" } }],
      edges: [],
    } as never);

    // Absent, not `undefined` — a document full of empty keys is noise, and it
    // makes every diff of a saved graph unreadable.
    expect("startingMsg" in doc.graph.nodes[0]).toBe(false);
    expect("stoppingMsg" in doc.graph.nodes[0]).toBe(false);
  });
});
