/**
 * The durable coordinator must say what `runFlow` says — the shared table, run
 * through the per-node driver.
 *
 * `conformance-run-diagnostics.test.ts` runs `flow/run-diagnostics` through
 * `runFlow`. This file runs the SAME rows through `Coordinator` and holds it to
 * the SAME expected warnings, so the two paths cannot drift apart without a row
 * going red.
 *
 * The gap it closes (0.71.0's "known gap"): each durable job replays the graph
 * and forwards only the events of the node that job runs. A node the frontier
 * SKIPS never gets a job, so an undelivered-edge warning addressed to it was
 * emitted inside other jobs' replays and filtered out — rows 0008, 0010 and
 * 0012, the graphs where the bad edge is the target's only inbound one, said
 * nothing on a durable run while `runFlow` warned.
 *
 * The fix emits at the skip decision, and the second half of this file pins
 * that it fires exactly once per skipped node even when two callers race to
 * make that decision.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/run-diagnostics/cases.json" with { type: "json" };
import { Coordinator, InMemoryClaimStore, type NodeClaimStore, type NodeState } from "../src/durable";
import { registerBuiltinKinds } from "../src/registry/builtin";
import type { FlowGraph, RunEvent } from "../src/types";

type Diagnostic = { nodeId: string | null; message: string; detail: unknown };

type Schema = { graph: { nodes: unknown[]; edges: unknown[] } };

type Case = {
  id: string;
  title: string;
  expected: Diagnostic[];
  skip?: Record<string, string>;
  input: {
    schema: Schema;
    initialInputs?: Record<string, Record<string, unknown>>;
  };
};

const cases = (CASES as { cases: Case[] }).cases;

registerBuiltinKinds();

describe("flow/run-diagnostics through the durable Coordinator", () => {
  // The vacuity guard. Most rows expect NO warnings, so an empty table — or
  // one that failed to load — would pass most of this file.
  it("loaded the shared table", () => {
    expect(cases.length).toBeGreaterThan(10);
    expect(cases.some((c) => c.expected.length > 0)).toBe(true);
  });

  for (const c of cases) {
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, async () => {
      const warnings: Diagnostic[] = [];
      const coordinator = new Coordinator({
        graph: toGraph(c.input.schema),
        // NO host executors, as in the in-process test: every kind runs the
        // executor it ships with.
        executors: {},
        run: `run_${c.id}`,
        initialInputs: c.input.initialInputs ?? {},
        onEvent: collectWarnings(warnings),
      });

      const result = await coordinator.runToCompletion();

      // A run that stalled would report fewer warnings for a reason that has
      // nothing to do with diagnostics.
      expect(result.paused).toBe(false);
      expect(result.error).toBeUndefined();
      expect(sortByMessage(warnings)).toEqual(c.expected);
    });
  }
});

describe("the skip decision warns exactly once", () => {
  // Row 0008's shape: the bad edge is `o`'s ONLY inbound edge, so `o` is
  // skipped by the frontier and never gets a job of its own.
  const schema: Schema = {
    graph: {
      nodes: [
        { id: "t", kind: "manual_trigger" },
        { id: "tf", kind: "transform", config: { expression: "{{ $json.name }}" } },
        { id: "o", kind: "output" },
      ],
      edges: [
        { id: "e1", source: "t", target: "tf" },
        { id: "e2", source: "tf", target: "o", sourceHandle: "result" },
      ],
    },
  };
  const initialInputs = { t: { name: "Ada" } };

  it("does not re-emit for a skip another caller already settled", async () => {
    const store = new SnapshotBarrierStore();
    const warnings: Diagnostic[] = [];
    const worker = () =>
      new Coordinator({
        graph: toGraph(schema),
        executors: {},
        run: "run_race",
        store,
        initialInputs,
        onEvent: collectWarnings(warnings),
      });

    const first = worker();
    const second = worker();

    await first.runNode("t");
    await first.runNode("tf");

    // Both callers read the SAME state, so both frontiers decide to skip `o`.
    // Only one of them transitions the row.
    store.holdNextReads(2);
    await Promise.all([first.advance(), second.advance()]);

    expect((await store.state("run_race")).o?.status).toBe("skipped");
    expect(warnings.map((w) => w.nodeId)).toEqual(["o"]);
    expect(warnings[0]!.detail).toEqual({ edge: "e2", source: "tf", sourceHandle: "result" });
  });

  it("treats a store whose skip returns nothing as having settled the node", async () => {
    // The interface predates the boolean. A store written against it returns
    // `void`, and must keep getting the warning rather than silently losing it.
    const warnings: Diagnostic[] = [];
    const coordinator = new Coordinator({
      graph: toGraph(schema),
      executors: {},
      run: "run_void",
      store: new VoidSkipStore(),
      initialInputs,
      onEvent: collectWarnings(warnings),
    });

    await coordinator.runToCompletion();

    expect(warnings.map((w) => w.nodeId)).toEqual(["o"]);
  });
});

/**
 * The document is a WorkflowSchema, so its nodes carry `kind` where the runtime
 * FlowNode wants `type`. The same mapping `conformance-run-diagnostics` uses.
 */
function toGraph(schema: Schema): FlowGraph {
  const nodes = (schema.graph.nodes as Array<Record<string, any>>).map((n) => ({
    id: n.id,
    type: n.kind,
    position: n.position ?? { x: 0, y: 0 },
    data: { kind: n.kind, config: n.config ?? {} },
  }));
  return { nodes, edges: schema.graph.edges } as never;
}

function collectWarnings(into: Diagnostic[]): (event: RunEvent) => void {
  return (e) => {
    if (e.type === "log" && e.level === "warn") {
      into.push({ nodeId: e.nodeId ?? null, message: e.message, detail: e.detail });
    }
  };
}

/** Sorted by MESSAGE, in code-point order — the table's contract. */
function sortByMessage(warnings: Diagnostic[]): Diagnostic[] {
  return [...warnings].sort((a, b) => compareCodePoints(a.message, b.message));
}

function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a, (ch) => ch.codePointAt(0)!);
  const right = Array.from(b, (ch) => ch.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/**
 * A store that can make several callers read the same snapshot.
 *
 * `holdNextReads(n)` parks the next `n` calls to `state()` until all `n` have
 * arrived, then releases them together. Each sees the state as it was when it
 * asked — before any of them wrote. That is the race two workers get from a
 * real database, made deterministic.
 */
class SnapshotBarrierStore implements NodeClaimStore {
  private readonly inner = new InMemoryClaimStore();
  private parked: Array<() => void> = [];
  private hold = 0;

  holdNextReads(n: number): void {
    this.hold = n;
  }

  claim(runKey: string, nodeId: string, owner: string) {
    return this.inner.claim(runKey, nodeId, owner);
  }
  state(runKey: string): Promise<Record<string, NodeState>> {
    const snapshot = this.inner.state(runKey);
    if (this.hold <= 0) return Promise.resolve(snapshot);

    this.hold -= 1;
    return new Promise((resolve) => {
      this.parked.push(() => resolve(snapshot));
      if (this.hold === 0) {
        const release = this.parked;
        this.parked = [];
        for (const go of release) go();
      }
    });
  }
  complete(runKey: string, nodeId: string, output: unknown, ports: readonly string[]) {
    this.inner.complete(runKey, nodeId, output, ports);
  }
  skip(runKey: string, nodeId: string) {
    return this.inner.skip(runKey, nodeId);
  }
  fail(runKey: string, nodeId: string, error: string) {
    this.inner.fail(runKey, nodeId, error);
  }
  pause(runKey: string, nodeId: string, reason: string) {
    this.inner.pause(runKey, nodeId, reason);
  }
}

/** A store written before `skip` reported anything: it returns `void`. */
class VoidSkipStore implements NodeClaimStore {
  private readonly inner = new InMemoryClaimStore();

  claim(runKey: string, nodeId: string, owner: string) {
    return this.inner.claim(runKey, nodeId, owner);
  }
  state(runKey: string) {
    return this.inner.state(runKey);
  }
  complete(runKey: string, nodeId: string, output: unknown, ports: readonly string[]) {
    this.inner.complete(runKey, nodeId, output, ports);
  }
  skip(runKey: string, nodeId: string): void {
    this.inner.skip(runKey, nodeId);
  }
  fail(runKey: string, nodeId: string, error: string) {
    this.inner.fail(runKey, nodeId, error);
  }
  pause(runKey: string, nodeId: string, reason: string) {
    this.inner.pause(runKey, nodeId, reason);
  }
}
