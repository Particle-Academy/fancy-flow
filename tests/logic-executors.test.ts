/**
 * The four pure-logic builtins now ship default executors (#13).
 *
 * They are reached through `runFlow` with an EMPTY host registry, because that
 * is the thing being claimed: a consumer who registers the builtins and runs a
 * graph gets working `branch` / `transform` / `merge` / `for_each` without
 * writing four executors from a schema.
 *
 * Each test drives the BUILDER path (`conditions[]` / `fields[]`) as well as
 * the raw escape hatch, because the builder is what the editor produces by
 * default and is the half the Python twin does not implement.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph, FlowNode } from "../src/types";

function node(id: string, type: string, config: Record<string, unknown> = {}): FlowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, config } } as unknown as FlowNode;
}

/** A trigger feeding one node, run with no host executors at all. */
async function runOne(type: string, config: Record<string, unknown>, payload: unknown) {
  const graph = {
    nodes: [node("t", "manual_trigger"), node("n", type, config)],
    edges: [{ id: "e", source: "t", target: "n" }],
  } as unknown as FlowGraph;

  return runFlow(graph, { manual_trigger: () => payload });
}

beforeEach(() => {
  registerBuiltinKinds();
});

describe("branch", () => {
  test("routes on the conditions BUILDER, which is what the editor emits", async () => {
    const result = await runOne(
      "branch",
      { match: "all", conditions: [{ left: "{{ $json.status }}", operator: "eq", right: "active" }] },
      { status: "active" },
    );

    expect(result.ok).toBe(true);
    expect(result.outputs.n).toMatchObject({ __port: "true" });
  });

  test("takes false when a condition does not hold", async () => {
    const result = await runOne(
      "branch",
      { match: "all", conditions: [{ left: "{{ $json.status }}", operator: "eq", right: "active" }] },
      { status: "archived" },
    );

    expect(result.outputs.n).toMatchObject({ __port: "false" });
  });

  test("`any` is OR and `all` is AND, on the same rows", async () => {
    const rows = [
      { left: "{{ $json.a }}", operator: "eq", right: "1" },
      { left: "{{ $json.b }}", operator: "eq", right: "2" },
    ];
    const payload = { a: 1, b: 99 };

    expect(
      (await runOne("branch", { match: "any", conditions: rows }, payload)).outputs.n,
    ).toMatchObject({ __port: "true" });
    expect(
      (await runOne("branch", { match: "all", conditions: rows }, payload)).outputs.n,
    ).toMatchObject({ __port: "false" });
  });

  test("compares as TEXT, so a number matches the text field beside it", async () => {
    // `right` is a plain text field in the schema. Strict equality would fail
    // on `2` vs `"2"` — a difference the author cannot see in the form.
    const result = await runOne(
      "branch",
      { conditions: [{ left: "{{ $json.count }}", operator: "eq", right: "2" }] },
      { count: 2 },
    );

    expect(result.outputs.n).toMatchObject({ __port: "true" });
  });

  test("the raw expression OVERRIDES the builder, as its own description says", async () => {
    const result = await runOne(
      "branch",
      {
        // The builder says false; the escape hatch says true. The schema's
        // description promises the escape hatch wins.
        conditions: [{ left: "{{ $json.status }}", operator: "eq", right: "never" }],
        condition: "{{ $json.ok }}",
      },
      { status: "x", ok: true },
    );

    expect(result.outputs.n).toMatchObject({ __port: "true" });
  });

  test("an UNCONFIGURED branch takes false, not true", async () => {
    // An empty `all` is vacuously true in logic, which would send a half-built
    // graph down the success path — the one place it should not go.
    const result = await runOne("branch", { match: "all", conditions: [] }, { any: "thing" });

    expect(result.outputs.n).toMatchObject({ __port: "false" });
  });

  test("a numeric comparison against something unparseable is false, not a crash", async () => {
    const result = await runOne(
      "branch",
      { conditions: [{ left: "{{ $json.missing }}", operator: "gt", right: "10" }] },
      { present: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.outputs.n).toMatchObject({ __port: "false" });
  });
});

describe("transform", () => {
  test("builds an object from the FIELDS rows", async () => {
    const result = await runOne(
      "transform",
      { mode: "fields", fields: [{ key: "name", value: "{{ $json.first }}" }, { key: "id", value: "{{ $json.id }}" }] },
      { first: "Ada", id: 7 },
    );

    expect(result.ok).toBe(true);
    expect(result.outputs.n).toEqual({ name: "Ada", id: 7 });
  });

  test("keeps the VALUE's type rather than stringifying it", async () => {
    const result = await runOne(
      "transform",
      { mode: "fields", fields: [{ key: "n", value: "{{ $json.count }}" }] },
      { count: 3 },
    );

    expect(result.outputs.n).toEqual({ n: 3 });
  });

  test("uses the single expression when the mode says so", async () => {
    const result = await runOne(
      "transform",
      { mode: "expression", expression: "{{ $json.user }}" },
      { user: { id: 1 } },
    );

    expect(result.outputs.n).toEqual({ id: 1 });
  });

  test("an UNCONFIGURED transform passes through rather than emptying the payload", async () => {
    // Returning `{}` here breaks every node downstream with no clue where the
    // data went.
    const result = await runOne("transform", { mode: "fields", fields: [{ key: "", value: "" }] }, { keep: "me" });

    expect(result.outputs.n).toEqual({ keep: "me" });
  });
});

describe("merge", () => {
  test("merges objects by key and keys non-objects by their PORT", async () => {
    const graph = {
      nodes: [
        node("a", "manual_trigger"),
        node("b", "manual_trigger"),
        node("m", "merge", { mode: "merge" }),
      ],
      edges: [
        { id: "e1", source: "a", target: "m", targetHandle: "left" },
        { id: "e2", source: "b", target: "m", targetHandle: "right" },
      ],
    } as unknown as FlowGraph;

    const result = await runFlow(graph, {
      manual_trigger: (ctx) => (ctx.node.id === "a" ? { x: 1 } : "plain"),
    });

    expect(result.ok).toBe(true);
    expect(result.outputs.m).toMatchObject({ x: 1, right: "plain" });
  });

  test("concat flattens into one list", async () => {
    const graph = {
      nodes: [
        node("a", "manual_trigger"),
        node("b", "manual_trigger"),
        node("m", "merge", { mode: "concat" }),
      ],
      edges: [
        { id: "e1", source: "a", target: "m", targetHandle: "left" },
        { id: "e2", source: "b", target: "m", targetHandle: "right" },
      ],
    } as unknown as FlowGraph;

    const result = await runFlow(graph, {
      manual_trigger: (ctx) => (ctx.node.id === "a" ? [1, 2] : 3),
    });

    expect(result.outputs.m).toEqual(expect.arrayContaining([1, 2, 3]));
  });
});

describe("for_each", () => {
  test("publishes the collection and its size", async () => {
    const result = await runOne("for_each", { source: "{{ $json.users }}" }, { users: ["a", "b", "c"] });

    expect(result.ok).toBe(true);
    expect(result.outputs.n).toEqual({ items: ["a", "b", "c"], count: 3 });
  });

  test("an object fans out its VALUES", async () => {
    const result = await runOne("for_each", { source: "{{ $json.map }}" }, { map: { a: 1, b: 2 } });

    expect(result.outputs.n).toEqual({ items: [1, 2], count: 2 });
  });

  test("a missing source is empty, not a crash", async () => {
    const result = await runOne("for_each", { source: "{{ $json.nope }}" }, {});

    expect(result.ok).toBe(true);
    expect(result.outputs.n).toEqual({ items: [], count: 0 });
  });
});

describe("the host still wins", () => {
  test("a registered executor overrides the shipped default", async () => {
    // The whole design of this package is that a host decides. Shipping
    // defaults must not take that away.
    const graph = {
      nodes: [node("t", "manual_trigger"), node("n", "transform", { mode: "fields", fields: [{ key: "k", value: "v" }] })],
      edges: [{ id: "e", source: "t", target: "n" }],
    } as unknown as FlowGraph;

    const result = await runFlow(graph, {
      manual_trigger: () => ({}),
      transform: () => "from the host",
    });

    expect(result.outputs.n).toBe("from the host");
  });
});
