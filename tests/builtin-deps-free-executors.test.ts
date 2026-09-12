/**
 * The deps-free builtins run without a host wiring them.
 *
 * ## What this pins, and why it is a parity test rather than a unit test
 *
 * `manual_trigger`, `output`, `log`, `variable` and `switch_case` need no
 * notifier, no store, no client and no network, and the PHP and Python twins
 * have always shipped executors for them. This runtime did not, purely by
 * omission — the "the host decides where I/O goes" rule was applied to kinds
 * that do no I/O.
 *
 * The cost was measured. A connector lab running one WorkflowSchema on three
 * engines hand-wrote `manual_trigger` and `output` for its Node lane while PHP
 * and Python got them from the engine. Every host writes the same one-liners,
 * slightly differently, and a parity suite then cannot tell "the runtimes
 * disagree" from "the two hosts disagree".
 *
 * So these assert the TWIN'S behaviour, not merely "something sensible". A
 * cleaner implementation here would be a divergence, and the contract is: same
 * WorkflowSchema in, same `RunResult.outputs` out.
 */
import { expect, test } from "vitest";
import { runFlow } from "../src/runtime/run-flow";
import type { RunEvent } from "../src/types";

function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, data: { kind: type, label: id, config } };
}

/**
 * Run with NO host executors at all — that is the whole point.
 *
 * Note the expression scope in these graphs: a node with an inbound edge sees
 * PORT-KEYED inputs, so a downstream expression reads `{{ in.field }}`, not
 * `{{ field }}`. `manual_trigger` is flat only because an entry point has no
 * inbound edge — which is exactly what its `emits: "input-map-merged"`
 * declaration says.
 */
async function run(
  nodes: ReturnType<typeof node>[],
  edges: unknown[] = [],
  // Keyed BY NODE ID -- `initialInputs` is `Record<nodeId, Record<key, value>>`,
  // not a flat bag. Passing it flat silently creates inputs for nodes that do
  // not exist and every real node sees {}, which reads as "the executor
  // returned nothing" rather than "the harness is wrong".
  initialInputs?: Record<string, Record<string, unknown>>,
) {
  const events: RunEvent[] = [];
  const result = await runFlow(
    { nodes, edges } as never,
    {} as never,
    (e: RunEvent) => events.push(e),
    initialInputs ? ({ initialInputs } as never) : undefined,
  );

  return { result, events };
}

test("manual_trigger publishes the run's initial inputs, unwired", async () => {
  const { result } = await run([node("start", "manual_trigger")], [], { start: { ticket: 42 } });

  expect(result.ok).toBe(true);
  // `$ctx->inputs` whole, matching ManualTriggerExecutor. This is what makes
  // `{{ trigger.field }}` resolve downstream, so an empty object here would
  // look like success and break every expression in the graph.
  expect(result.outputs.start).toEqual({ ticket: 42 });
});

test("output publishes its `in` port UNWRAPPED, not a port map", async () => {
  const { result } = await run(
    [node("start", "manual_trigger"), node("out", "output")],
    [{ id: "e1", source: "start", target: "out", targetHandle: "in" }],
    { start: { value: "hello" } },
  );

  expect(result.ok).toBe(true);
  // `in ?? inputs`, matching OutputExecutor. The terminal entry in `outputs`
  // being the plain result rather than `{in: …}` is the property every host
  // reads a run's answer out of.
  expect(result.outputs.out).toEqual({ value: "hello" });
});

test("output with no inbound edge falls back to the whole input map", async () => {
  const { result } = await run([node("out", "output")], [], { out: { a: 1 } });

  expect(result.ok).toBe(true);
  expect(result.outputs.out).toEqual({ a: 1 });
});

test("variable resolves its expression and publishes it BARE", async () => {
  const { result } = await run(
    [node("start", "manual_trigger"), node("v", "variable", { value: "{{ in.name }}" })],
    [{ id: "e1", source: "start", target: "v", targetHandle: "in" }],
    { start: { name: "ada" } },
  );

  expect(result.ok).toBe(true);
  // Not `{value: "ada"}`. VariableExecutor returns the resolved value itself.
  expect(result.outputs.v).toBe("ada");
});

test("variable passes a non-string config value through unchanged", async () => {
  const { result } = await run([node("v", "variable", { value: 7 })]);

  expect(result.ok).toBe(true);
  expect(result.outputs.v).toBe(7);
});

test("log emits an event rather than writing to a console, and says what it logged", async () => {
  const { result, events } = await run(
    [node("start", "manual_trigger"), node("l", "log", { level: "warn", message: "hi {{ in.who }}" })],
    [{ id: "e1", source: "start", target: "l", targetHandle: "in" }],
    { start: { who: "there" } },
  );

  expect(result.ok).toBe(true);
  expect(result.outputs.l).toEqual({ logged: "hi there", level: "warn" });

  // Where a host's logs GO is a host decision; a console.log here would be this
  // package making it.
  const logged = events.filter((e) => e.type === "log");
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({ nodeId: "l", level: "warn", message: "hi there" });
});

test("switch_case routes to the port its resolved value names", async () => {
  const { result } = await run(
    [
      node("start", "manual_trigger"),
      node("s", "switch_case", { value: "{{ in.tier }}", cases: { gold: "vip" } }),
    ],
    [{ id: "e1", source: "start", target: "s", targetHandle: "in" }],
    { start: { tier: "gold" } },
  );

  expect(result.ok).toBe(true);
  expect(result.outputs.s).toMatchObject({ __port: "vip" });
});

test("an unmatched value takes default AND says so, because the two look identical", async () => {
  const { result, events } = await run(
    [
      node("start", "manual_trigger"),
      node("s", "switch_case", { value: "{{ in.missing }}", cases: { gold: "vip" } }),
    ],
    [{ id: "e1", source: "start", target: "s", targetHandle: "in" }],
    { start: { tier: "gold" } },
  );

  expect(result.ok).toBe(true);
  expect(result.outputs.s).toMatchObject({ __port: "default" });

  // The silent mis-route `branch` has one step over: an expression that does
  // not resolve becomes "", matches no case, and takes `default` —
  // indistinguishable from a value that genuinely matched nothing. The twins
  // warn; so does this, or the routing decision is unaccountable.
  const warned = events.filter((e) => e.type === "log" && e.level === "warn");
  expect(warned).toHaveLength(1);
  expect((warned[0] as { message: string }).message).toContain("matches no case");
});

test("a literal value that matches no case does NOT warn", async () => {
  // Only an UNRESOLVED expression is ambiguous. A literal miss is a fact the
  // author can see in the config, and warning on it would train people to
  // ignore the warning that matters.
  const { events } = await run([node("s", "switch_case", { value: "bronze", cases: { gold: "vip" } })]);

  expect(events.filter((e) => e.type === "log" && e.level === "warn")).toHaveLength(0);
});

test("a host executor still wins over the shipped default", async () => {
  // `pickExecutor` consults the host registry first. Anyone who already wrote
  // these keeps theirs — shipping a default must not silently replace a host's.
  let ran = false;
  const result = await runFlow(
    { nodes: [node("start", "manual_trigger")], edges: [] } as never,
    { manual_trigger: async () => { ran = true; return { mine: true }; } } as never,
    () => {},
  );

  expect(ran).toBe(true);
  expect(result.outputs.start).toEqual({ mine: true });
});
