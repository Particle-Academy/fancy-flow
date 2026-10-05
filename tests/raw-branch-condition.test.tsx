import { describe, expect, it } from "vitest";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph } from "../src/types";

registerBuiltinKinds();

/**
 * A raw (non-string) `branch.condition` routes the same way here as in the twins.
 *
 * ## The divergence this closes
 *
 * `{ kind: "branch", config: { condition: true } }` — a RAW boolean, not an
 * expression string — routed **`false`** in TypeScript and **`true`** in the PHP,
 * Python and Rust runtimes. Same `WorkflowSchema` JSON, different route, which is
 * the one thing this package promises cannot happen.
 *
 * Measured rather than assumed, because the issue reporting it said plainly that
 * it had not been checked end to end:
 *
 *   - **TypeScript**, run through `runFlow` before any change: `true`, `false`,
 *     `1` and `0` ALL took the `false` port. A non-string fell past the
 *     expression path into the structured-builder path, found no
 *     `config.conditions`, and took the deliberate empty-rows answer of `false`.
 *   - **PHP**, read from `BranchExecutor` + `Expr`: `evaluate()` returns a
 *     non-string unchanged and `truthy()` passes booleans through, so `true`
 *     routes `true` and `0` routes `false`.
 *
 * ## Why TypeScript was the side that moved
 *
 * Its empty-`conditions` rule exists so an UNCONFIGURED branch is falsy — a
 * half-built graph should not take the success path. That reasoning is right, and
 * it does not apply here: a raw `true` is a *configured* condition, and reading it
 * as "unconfigured" is what produced the divergence.
 *
 * So a boolean or number is now honoured, and the unconfigured case — condition
 * absent, null, or an empty string with no `conditions` rows — stays falsy. Both
 * halves are asserted below, because fixing the first by breaking the second
 * would be a different bug with the same test passing.
 *
 * `switch_case` is NOT affected: it stringifies its resolved value before looking
 * up a case, so a raw boolean has always become `"true"` in every runtime.
 */

async function portFor(config: Record<string, unknown>): Promise<string> {
  const graph = {
    nodes: [
      { id: "b", type: "branch", position: { x: 0, y: 0 }, data: { config } },
      { id: "t", type: "transform", position: { x: 1, y: 0 }, data: { config: {} } },
      { id: "f", type: "transform", position: { x: 2, y: 0 }, data: { config: {} } },
    ],
    edges: [
      { id: "e1", source: "b", target: "t", sourceHandle: "true" },
      { id: "e2", source: "b", target: "f", sourceHandle: "false" },
    ],
  } as unknown as FlowGraph;

  const result = await runFlow(graph, {}, undefined, { initialInputs: { in: {} } });
  const reached = Object.keys(result.outputs);

  if (reached.includes("t") && reached.includes("f")) return "BOTH";
  if (reached.includes("t")) return "true";
  if (reached.includes("f")) return "false";
  return "neither";
}

describe("raw branch.condition matches the PHP/Python/Rust twins", () => {
  // Each of these took `false` before the fix. The `false`/`0` rows passed
  // then too, and are kept precisely so a fix that routes everything `true`
  // cannot pass.
  const honoured: Array<[unknown, string]> = [
    [true, "true"],
    [false, "false"],
    [1, "true"],
    [0, "false"],
    [-1, "true"],
  ];

  for (const [condition, expected] of honoured) {
    it(`condition: ${JSON.stringify(condition)} routes ${expected}`, async () => {
      expect(await portFor({ condition })).toBe(expected);
    });
  }

  // The other half of the rule. An unconfigured branch must stay falsy, which
  // is the behaviour the structured-builder path was protecting.
  const unconfigured: unknown[] = [undefined, null, "", "   "];

  for (const condition of unconfigured) {
    it(`unconfigured (condition: ${JSON.stringify(condition)}) stays false`, async () => {
      expect(await portFor(condition === undefined ? {} : { condition })).toBe("false");
    });
  }

  it("a structured conditions array still decides when there is no condition", async () => {
    // The key is `operator`, and it DEFAULTS TO "eq" when absent — so a row with
    // a misspelled key compares undefined to undefined and quietly passes. That
    // cost one red test here; it would cost a wrong route in a real graph.
    expect(
      await portFor({ conditions: [{ left: "{{ in.n }}", operator: "truthy" }], match: "all" }),
    ).toBe("false");

    expect(
      await portFor({
        conditions: [{ left: "a", operator: "eq", right: "a" }],
        match: "all",
      }),
    ).toBe("true");
  });

  it("an object condition is not honoured — only booleans and numbers are", async () => {
    // A map is neither an expression nor a scalar truth value. Treating it as
    // truthy because it is a non-empty object would make a typo'd config route
    // `true`, which is the direction that silently does the wrong thing.
    expect(await portFor({ condition: { nope: 1 } })).toBe("false");
  });
});
