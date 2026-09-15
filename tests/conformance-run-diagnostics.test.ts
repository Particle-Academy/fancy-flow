/**
 * A graph that runs and delivers nothing must say so — the shared table, run
 * against THIS side.
 *
 * Two warnings, one silent failure. An edge whose `sourceHandle` names a port
 * its source can never publish binds nothing, and a `branch` / `switch_case`
 * routing on a path that does not resolve takes `false` / `default` for a reason
 * that has nothing to do with the data. Either way the run reports success.
 *
 * Measured before it was written down (fancy-flow#17): the flabs smart-routing
 * reference graph carried an inverted `cases` map. PHP warned about the dead
 * edge at once; this engine ran the identical graph and said nothing. Row 0010
 * is that graph.
 *
 * Half the rows are SILENT on purpose. A warning that fires on ordinary
 * branching is noise, and noise is how a real warning stops being read — so the
 * untaken branch port (0009), a port that exists only because of the node's own
 * `cases` (0011), a source that never ran (0014) and a value that resolves to
 * null (0003) are each pinned as saying nothing.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/run-diagnostics/cases.json" with { type: "json" };
import { runFlow } from "../src/runtime/run-flow";
import { registerBuiltinKinds } from "../src/registry/builtin";
import type { RunEvent } from "../src/types";

type Diagnostic = { nodeId: string | null; message: string; detail: unknown };

type Case = {
  id: string;
  title: string;
  expected: Diagnostic[];
  skip?: Record<string, string>;
  input: {
    schema: { graph: { nodes: unknown[]; edges: unknown[] } };
    initialInputs?: Record<string, Record<string, unknown>>;
  };
};

const cases = (CASES as { cases: Case[] }).cases;

registerBuiltinKinds();

describe("flow/run-diagnostics", () => {
  // The vacuity guard. Eight of the fourteen rows expect NO warnings, so an
  // empty table — or one that failed to load — would pass most of this file.
  it("loaded the shared table", () => {
    expect(cases.length).toBeGreaterThan(10);
    expect(cases.some((c) => c.expected.length > 0)).toBe(true);
  });

  for (const c of cases) {
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, async () => {
      expect(await runDiagnostics(c.input.schema, c.input.initialInputs ?? {})).toEqual(c.expected);
    });
  }
});

/**
 * The contract: every `log` event at level `warn`, sorted by message.
 *
 * Run with NO host executors, so every kind in the table goes through the
 * executor it ships with — the question is what THIS engine says, and a
 * hand-written stand-in would be answering for it.
 */
async function runDiagnostics(
  schema: Case["input"]["schema"],
  initialInputs: Record<string, Record<string, unknown>>,
): Promise<Diagnostic[]> {
  // The document is a WorkflowSchema, so its nodes carry `kind` where the
  // runtime FlowNode wants `type`. The same mapping `flow/entry-points` uses.
  const nodes = (schema.graph.nodes as Array<Record<string, any>>).map((n) => ({
    id: n.id,
    type: n.kind,
    position: n.position ?? { x: 0, y: 0 },
    data: { kind: n.kind, config: n.config ?? {} },
  }));

  const events: RunEvent[] = [];
  await runFlow(
    { nodes, edges: schema.graph.edges } as never,
    {} as never,
    (e) => events.push(e),
    { initialInputs },
  );

  const warnings: Diagnostic[] = [];
  for (const e of events) {
    if (e.type === "log" && e.level === "warn") {
      warnings.push({ nodeId: e.nodeId ?? null, message: e.message, detail: e.detail });
    }
  }

  // Sorted by MESSAGE, not emission order: same-depth nodes may be reached in a
  // different order by another runtime, and ordering is `flow/graph-runs`'
  // question. Code-point order, which UTF-16 `<` is not for astral characters.
  return warnings.sort((a, b) => compareCodePoints(a.message, b.message));
}

function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a, (ch) => ch.codePointAt(0)!);
  const right = Array.from(b, (ch) => ch.codePointAt(0)!);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}
