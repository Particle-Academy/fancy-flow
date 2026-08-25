/**
 * Which executor a node runs — the shared table, run against THIS side.
 *
 * ## Why this suite exists
 *
 * `pickExecutor` could run the **wrong executor, silently**. Its alias step
 * resolved `data.kind`'s ids before `node.type`'s, so a node like
 *
 *     { type: "llm_call", data: { kind: "output" } }
 *
 * ran the OUTPUT executor — **even when an `llm_call` executor was registered**
 * (`0203`). Nothing reported it and nothing could: running the wrong executor
 * and running the right one look identical from outside, because the graph
 * still completes and produces a value.
 *
 * The rule the rows pin: **`node.type` is authoritative when it names a
 * registered kind**, and `data.kind` does not contribute; otherwise `data.kind`
 * decides. `0205` is what keeps that from over-reaching — a `type` naming no
 * registered kind is an xyflow RENDERER type, which is ordinary practice.
 *
 * The rows live in `@particle-academy/fancy-conformance` rather than here
 * because fancy-flow-php and fancy-flow (Python) answer the same question. The
 * `0200` rows carry a per-row `skip` for both: their `FlowNode` is FLATTENED —
 * `type` IS the kind, with no `data` slot for a second opinion — so the
 * precedence question cannot arise there. That asymmetry is why exactly one
 * runtime had this bug, and the skip reasons say so rather than hiding it.
 *
 * Imported from the INSTALLED package, never a sibling checkout: the
 * conformance repo's runner README records that its two older parity harnesses
 * hard-coded `../../<repo>/src/` and therefore ran in one directory layout and
 * silently no-op'd everywhere else, CI included.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/executor-resolution/cases.json" with { type: "json" };
import { registerNodeKind } from "../src/registry/registry";
import { runFlow } from "../src/runtime/run-flow";

type Case = {
  id: string;
  title: string;
  expected: string | null;
  skip?: Record<string, string>;
  input: {
    kinds: Array<{ name: string; aliases?: string[] }>;
    bindings: Array<{ key: string; executor: string }>;
    node: { id: string; type?: string | null; dataKind?: string };
  };
};

const cases = (CASES as { cases: Case[] }).cases;

describe("flow/executor-resolution", () => {
  // A vacuity guard. `cases.length` reaching zero — a bad path, a renamed export,
  // an empty tarball — would make every assertion below pass over nothing, which
  // is the failure mode fancy-conformance exists to argue against.
  it("loaded the shared table", () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  for (const c of cases) {
    // A skip must be VISIBLE. `it.skip` prints the row and its reason rather
    // than quietly shrinking the count — a bare "n skipped" reads identically
    // to full coverage.
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, async () => {
      for (const k of c.input.kinds) {
        registerNodeKind({
          name: k.name,
          aliases: k.aliases ?? [],
          label: k.name,
          category: "conformance",
        } as never);
      }

      // Each binding runs a recogniser rather than real work, so the assertion
      // is about WHICH executor was chosen. That also keeps the table neutral
      // about when a runtime expands aliases: PHP and Python expand at bind
      // time and TypeScript at lookup time, and both must still run this one.
      let ran: string | null = null;
      const executors: Record<string, unknown> = {};
      for (const b of c.input.bindings) {
        executors[b.key] = () => {
          ran = b.executor;
          return 1;
        };
      }

      const n = c.input.node;
      await runFlow(
        {
          nodes: [
            {
              id: n.id,
              type: n.type ?? undefined,
              position: { x: 0, y: 0 },
              data: n.dataKind === undefined ? {} : { kind: n.dataKind },
            },
          ],
          edges: [],
        } as never,
        executors as never,
        () => {},
      );

      expect(ran).toBe(c.expected);
    });
  }
});
