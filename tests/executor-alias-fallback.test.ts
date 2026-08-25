/**
 * An executor keyed by a kind's NAMESPACED id must resolve.
 *
 * `resolveKindId("manual_trigger")` returns `@particle-academy/manual_trigger`,
 * so keying a registry by what that function hands you is the natural thing to
 * do — and it was the one spelling that failed.
 *
 * ## The actual mechanism, because it is not the obvious one
 *
 * `pickExecutor` resolves a kind NAME first (`data.kind ?? node.type`) and then
 * looks up every id that kind answers to. Both halves were right. The bug was
 * that it committed to ONE name: when `data.kind` held a string the registry
 * does not know, `getNodeKind()` returned null, and the alias loop never ran at
 * all — so `node.type`'s aliases were never tried even though `node.type` names
 * a real kind.
 *
 * The reporter's graph carried `data: { kind: "trigger" }` on a node of type
 * `manual_trigger` — a category-ish label rather than a kind id. That is easy to
 * write and there is no reason it should cost the node its aliases: `node.type`
 * still says exactly what the node is.
 *
 * Reported by an outside consumer building a trading advisory system, who noted
 * the error made it look like the kind was missing rather than mis-keyed. It
 * cost them iterations, and it nearly escaped a second time: my first probe used
 * `data: {}`, which falls back to `node.type` and passes — so I reported it as
 * not reproducible. The reporter's exact graph is what caught it.
 */
import { describe, expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import { getNodeKind, kindIds } from "../src/registry/registry";

/** Their graph, unchanged — `data.kind` is a label the registry does not know. */
function graph() {
  return {
    nodes: [
      {
        id: "start",
        type: "manual_trigger",
        position: { x: 0, y: 0 },
        data: { kind: "trigger", label: "start", config: {} },
      },
    ],
    edges: [],
  };
}

async function runKeyedBy(key: string) {
  let ran = false;
  const result = await runFlow(
    graph() as never,
    { [key]: async () => { ran = true; return { ok: 1 }; } } as never,
    () => {},
  );
  return { ok: result.ok, error: result.error, ran };
}

test("the premise: data.kind here names nothing, node.type names a real kind", () => {
  // If this ever changes, the test below stops testing what it says it does.
  expect(getNodeKind("trigger")).toBeNull();
  expect(getNodeKind("manual_trigger")).not.toBeNull();
});

describe("every id a kind answers to resolves an executor", () => {
  test.each(kindIds(getNodeKind("manual_trigger")!))("keyed by %s", async (key) => {
    const { ok, error, ran } = await runKeyedBy(key);

    expect(ok, `keyed by "${key}": ${error ?? ""}`).toBe(true);
    expect(ran, `the executor keyed by "${key}" never ran`).toBe(true);
  });
});

test("an unknown data.kind does not cost the node its node.type aliases", async () => {
  // The regression in one line. `@particle-academy/manual_trigger` is what
  // `resolveKindId` returns, and it failed while the bare name worked.
  const { ok } = await runKeyedBy("@particle-academy/manual_trigger");

  expect(ok).toBe(true);
});

test("the failure names what it LOOKED FOR, not just what the node calls itself", async () => {
  // The half of the report that actually cost the reporter time. The old
  // message was `kind=manual_trigger`, which reads as "that kind is missing"
  // about a kind that exists and is registered — under a different key.
  const result = await runFlow(
    graph() as never,
    { something_else: async () => 1 } as never,
    () => {},
  );

  expect(result.ok).toBe(false);
  expect(result.error).toContain("@particle-academy/manual_trigger");
  expect(result.error).toContain("manual_trigger");
  expect(result.error).toContain('"*"');
});

test("the ids the message lists are the ids the lookup actually tries", async () => {
  // An error listing keys that were never checked is worse than one listing
  // none: it sends the reader to verify something that never happened. So each
  // id the message names must, on its own, resolve an executor.
  const failure = await runFlow(graph() as never, {} as never, () => {});
  const listed = [...(failure.error ?? "").matchAll(/"([^"*]+)"/g)].map((m) => m[1]);

  expect(listed.length).toBeGreaterThan(2);

  for (const id of listed) {
    const { ok } = await runKeyedBy(id);
    expect(ok, `the message lists "${id}" but keying by it does not resolve`).toBe(true);
  }
});
