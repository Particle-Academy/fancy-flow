/**
 * A subflow with no `inputs` mapping hands the parent's inputs to every entry
 * node of the child.
 *
 * The executor's own comment already said so ("hand the parent's inputs to the
 * child's entry points"), but the code seeded `initialInputs: { __parent: … }`.
 * `initialInputs` is keyed by NODE ID, and no node is called `__parent`, so the
 * key seeded nothing and the child's entry node ran with no inputs at all. No
 * error, no warning: a child that reads `{{ in.ref }}` rendered empty.
 *
 * Found by the flabs Flow lanes (2026-09-14), which run one graph on every
 * engine and compare. The PHP and Python engines seed every entry node of the
 * child with the parent's inputs; this one handed the child nothing. A parity
 * table of graph runs never contained a subflow without a mapping, so nothing
 * had compared them.
 *
 * The rule now matches both: a non-empty `inputs` mapping is used as given;
 * absent or empty, every node of the child with no incoming edge receives the
 * parent node's inputs.
 */
import { afterEach, describe, expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import { registerWorkflowResolver } from "../src/registry/capabilities";
import { registerBuiltinKinds } from "../src/registry/builtin";

registerBuiltinKinds();

const teardown: Array<() => void> = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

const node = (id: string, kind: string, config: Record<string, unknown> = {}) => ({
  id,
  type: kind,
  position: { x: 0, y: 0 },
  data: { kind, label: id, config },
});

/** Two entry nodes, so "every entry node" is tested rather than "the first". */
const child = {
  nodes: [node("in", "manual_trigger"), node("other", "manual_trigger"), node("work", "transform", { expression: "{{ in }}" })],
  edges: [{ id: "c1", source: "in", target: "work" }],
};

const parent = (config: Record<string, unknown> = {}) => ({
  nodes: [node("start", "manual_trigger"), node("reuse", "subflow", { workflow: "child", ...config })],
  edges: [{ id: "p1", source: "start", target: "reuse" }],
});

const payload = { payload: { ref: "ORD-77" } };

const run = async (config: Record<string, unknown> = {}) => {
  teardown.push(registerWorkflowResolver((ref) => (ref === "child" ? (child as never) : null)));

  const result = await runFlow(parent(config) as never, {}, () => {}, { initialInputs: { start: payload } });
  expect(result.ok, String(result.error)).toBe(true);

  return (result.outputs.reuse as { __port: string; value: Record<string, unknown> }).value;
};

describe("subflow child inputs", () => {
  test("with no mapping, every entry node of the child receives the parent's inputs", async () => {
    const outputs = await run();

    expect(outputs.in).toMatchObject({ in: payload });
    expect(outputs.other).toMatchObject({ in: payload });
    // And what the entry node emits reaches the rest of the child.
    expect(outputs.work).toBeTruthy();
    expect(JSON.stringify(outputs.work)).toContain("ORD-77");
  });

  test("an EMPTY mapping is no mapping, as in the PHP and Python engines", async () => {
    const outputs = await run({ inputs: {} });

    expect(outputs.in).toMatchObject({ in: payload });
  });

  test("a mapping is used as given", async () => {
    const outputs = await run({ inputs: { other: { chosen: true } } });

    expect(outputs.other).toMatchObject({ chosen: true });
    expect(JSON.stringify(outputs.in ?? null)).not.toContain("ORD-77");
  });
});
