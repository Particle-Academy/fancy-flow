/**
 * The corners of the two run diagnostics that the shared table does not reach.
 *
 * `conformance-run-diagnostics.test.ts` runs `flow/run-diagnostics` — the
 * contract. These pin the parts of the PHP twin's rule the table leaves out,
 * each a way this runtime could warn too often, too rarely, or advise something
 * that cannot be followed.
 */
import { expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import { registerBuiltinKinds } from "../src/registry/builtin";
import type { RunEvent } from "../src/types";

registerBuiltinKinds();

function node(id: string, kind: string, config: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { id, type: kind, position: { x: 0, y: 0 }, data: { kind, config, ...extra } };
}

async function warnings(
  nodes: ReturnType<typeof node>[],
  edges: unknown[],
  initialInputs: Record<string, Record<string, unknown>> = {},
): Promise<Array<{ nodeId?: string; message: string; detail?: unknown }>> {
  const events: RunEvent[] = [];
  await runFlow({ nodes, edges } as never, {} as never, (e) => events.push(e), { initialInputs });

  return events.flatMap((e) =>
    e.type === "log" && e.level === "warn" ? [{ nodeId: e.nodeId, message: e.message, detail: e.detail }] : [],
  );
}

test("a HANDLE-LESS edge out of a node with named ports only warns, and offers no handle to remove", async () => {
  // `for_each` publishes `item` and `done`, never `out`, so a handle-less edge
  // — which reads `out` — binds nothing. There is no sourceHandle to leave off,
  // so suggesting it would be advice that cannot be followed.
  const found = await warnings(
    [node("t", "manual_trigger"), node("fe", "for_each", { source: "{{ $json.items }}" }), node("o", "output")],
    [
      { id: "e1", source: "t", target: "fe" },
      { id: "e2", source: "fe", target: "o" },
    ],
    { t: { items: [1] } },
  );

  expect(found).toEqual([
    {
      nodeId: "o",
      message:
        'Edge e2 reads port "out" from node fe, which never publishes it — nothing would reach o at run time. '
        + "Available: item, done.",
      detail: { edge: "e2", source: "fe", sourceHandle: "out" },
    },
  ]);
});

test("an unconfigured switch_case answers with its DEFAULT-config ports, as the twin does", async () => {
  // With no `cases`, the executor can only take `default`. PHP's port rule
  // nonetheless treats the kind's representative ports (`case_a`, `case_b`,
  // `default`) as possible, so an edge from `case_a` is silent there. Warning
  // here and not there is a parity failure on the same document.
  const found = await warnings(
    [
      node("t", "manual_trigger"),
      node("s", "switch_case", { value: "{{ kind }}" }),
      node("a", "output"),
      node("x", "output"),
    ],
    [
      { id: "e1", source: "t", target: "s" },
      { id: "e2", source: "s", target: "a", sourceHandle: "case_a" },
      { id: "e3", source: "s", target: "x", sourceHandle: "nope" },
    ],
    { t: { kind: "a" } },
  );

  // `kind` is not under `in`, so the value resolves to nothing as well — two
  // warnings, and `case_a` is not among them.
  expect(found.map((w) => w.detail)).toEqual([
    { node: "s", configKey: "value", path: "kind", tookPort: "default" },
    { edge: "e3", source: "s", sourceHandle: "nope" },
  ]);
});

test("a node's OWN declared outputs decide which ports are possible, ahead of its kind", async () => {
  // The document is more specific than the kind. A branch whose node lists only
  // `true` and `yes` cannot be said to possibly publish `false`, whatever
  // `branch` declares.
  const found = await warnings(
    [
      node("t", "manual_trigger"),
      node("b", "branch", { condition: "{{ $json.go }}" }, { outputs: [{ id: "true" }, { id: "yes" }] }),
      node("y", "output"),
      node("f", "output"),
    ],
    [
      { id: "e1", source: "t", target: "b" },
      { id: "e2", source: "b", target: "y", sourceHandle: "yes" },
      { id: "e3", source: "b", target: "f", sourceHandle: "false" },
    ],
    { t: { go: true } },
  );

  expect(found.map((w) => w.detail)).toEqual([{ edge: "e3", source: "b", sourceHandle: "false" }]);
});

test("a branch built from the `conditions` rows never reports a path, even when a row reads nothing", async () => {
  // The routing warning is about the raw `condition` — a single whole
  // expression. A builder row comparing a missing field is a comparison that
  // did not hold, which is what the builder is for.
  const found = await warnings(
    [
      node("t", "manual_trigger"),
      node("b", "branch", { conditions: [{ left: "{{ $json.missing }}", operator: "eq", right: "x" }] }),
    ],
    [{ id: "e1", source: "t", target: "b" }],
    { t: { present: 1 } },
  );

  expect(found).toEqual([]);
});
