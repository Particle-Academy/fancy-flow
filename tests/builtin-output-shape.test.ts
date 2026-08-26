/**
 * What the builtin kinds declare they emit, and — just as load-bearing — what
 * they deliberately do NOT.
 *
 * A note on what a declaration MEANS here, because it differs from the PHP twin
 * and the difference is easy to misread. **This package ships no executors**; a
 * host supplies them. So `outputShape` here is the CONTRACT a conforming
 * executor must satisfy, not a description of code in this repo. The PHP twin
 * ships its executors, so over there the same declaration describes real
 * behaviour — which is why its rows were read line-by-line from those executors
 * and mirrored here rather than invented.
 *
 * The consequence for a host: if your `notify` executor returns something other
 * than `{ sent, channel, to, message }`, the declaration is not wrong — your
 * executor is not conforming, and anything reading the shape will mislead an
 * author about your graph.
 */
import { describe, expect, test } from "vitest";
import { getNodeKind, listNodeKinds } from "../src/registry/registry";
import { outputFieldsFor } from "../src/expressions/variables";

const paths = (kindId: string, config: Record<string, unknown> = {}) => {
  const kind = getNodeKind(kindId);
  expect(kind, `builtin \`${kindId}\` is not registered`).not.toBeNull();
  const shape = kind!.outputShape;
  if (shape === undefined) return null;
  return (typeof shape === "function" ? shape(config as never) : shape).map((f) => f.path);
};

describe("builtin output shapes", () => {
  test.each([
    ["@particle-academy/api_request", ["status", "headers", "body"]],
    ["@particle-academy/embed_search", ["query", "matches"]],
    ["@particle-academy/llm_router", ["route", "reason", "input"]],
    ["@particle-academy/notify", ["sent", "channel", "to", "message"]],
    ["@particle-academy/webhook_out", ["sent", "status", "response"]],
    ["@particle-academy/for_each", ["items", "count"]],
    ["@particle-academy/wait", ["waited", "duration", "input"]],
    ["@particle-academy/log", ["logged", "level"]],
  ])("%s declares its fields", (kindId, expected) => {
    expect(paths(kindId)).toEqual(expected);
  });

  test("llm_call gains `data` only when a response_schema was asked for", () => {
    // Filed as an engine bug twice against a consumer, by an agent, on two
    // different workflows: `{{ in.output }}` on a kind that emits `text`.
    expect(paths("@particle-academy/llm_call")).toEqual(["text", "usage", "raw"]);
    expect(paths("@particle-academy/llm_call", { response_schema: { type: "object" } }))
      .toEqual(["text", "data", "usage", "raw"]);
  });

  test("user_input emits the keys its author defined", () => {
    expect(paths("@particle-academy/user_input", { fields: [{ key: "email" }, { key: "note" }] }))
      .toEqual(["email", "note"]);
  });

  test("pass-through kinds stay UNDECLARED rather than guessing", () => {
    // They emit what arrived, so their shape is not knowable from the kind
    // alone. Undeclared is the honest answer and a reader must treat it as
    // "unknown, do not refuse" -- never as "emits nothing".
    //
    // schedule_trigger is the sharp one: the reference executor merges its
    // inputs into the TOP level, so a partial list of ["cron","timezone"] would
    // make a validator refuse every merged-in key. A partial static list on a
    // merging kind is a false-rejection generator.
    for (const id of [
      "branch", "switch_case", "output", "transform", "merge",
      "manual_trigger", "webhook_trigger", "human_approval",
      "variable",
      // schedule_trigger LEFT this list when `emits` arrived: a partial
      // ["cron","timezone"] list was unsafe only while nothing could say the
      // inputs also merge. With emits: "inputs-merged" beside it the two are
      // complete together.
    ]) {
      expect(paths(`@particle-academy/${id}`), `${id} should not declare a shape`).toBeNull();
    }
  });

  test("outputFieldsFor agrees with the declaration it reads", () => {
    // The accessor consumers actually call. If it disagreed with the raw
    // property, every reader would get a different answer depending on which
    // one it happened to use.
    const node = { id: "n", type: "@particle-academy/notify", data: { kind: "@particle-academy/notify" } };
    expect(outputFieldsFor(node as never).map((f) => f.path))
      .toEqual(["sent", "channel", "to", "message"]);
  });

  test("no declared field has an empty path", () => {
    for (const kind of listNodeKinds()) {
      const shape = kind.outputShape;
      if (shape === undefined) continue;
      const fields = typeof shape === "function" ? shape({} as never) : shape;
      for (const f of fields) {
        expect(f.path, `${kind.name} declared a field with no path`).not.toBe("");
      }
    }
  });
});

describe("emits — the relation a field list cannot express", () => {
  const relation = (kindId: string, config: Record<string, unknown> = {}) => {
    const kind = getNodeKind(kindId);
    expect(kind, `\`${kindId}\` is not registered`).not.toBeNull();
    const e = kind!.emits;
    if (e === undefined) return null;
    return typeof e === "function" ? e(config as never) : e;
  };

  test.each([
    ["branch", "input"],
    ["switch_case", "input"],
    ["output", "input"],
    ["human_approval", "input"],
    ["manual_trigger", "input"],
    ["variable", "expression:value"],
    ["schedule_trigger", "inputs-merged"],
  ])("%s declares `%s`", (id, expected) => {
    expect(relation(`@particle-academy/${id}`)).toBe(expected);
  });

  test("transform's relation depends on its config", () => {
    // Two behaviours: the input unchanged with no expression, else the shape
    // that expression names.
    expect(relation("@particle-academy/transform")).toBe("input");
    expect(relation("@particle-academy/transform", { expression: "" })).toBe("input");
    expect(relation("@particle-academy/transform", { expression: "{{ in.user }}" }))
      .toBe("expression:expression");
  });

  test("merge concatenating declares NO relation, and no empty field list", () => {
    // A list's elements are not addressable as top-level fields. `[]` would
    // claim "emits no fields", which is false and would refuse everything.
    expect(relation("@particle-academy/merge")).toBe("inputs-merged");
    expect(relation("@particle-academy/merge", { mode: "concat" })).toBeNull();
    expect(paths("@particle-academy/merge")).toBeNull();
  });

  test("wait declares a LIST and NO relation, because it NESTS", () => {
    // It returns { waited, duration, input } -- the input goes UNDER a key.
    // emits: "input" would make a reader accept {{ in.<any inbound field> }} at
    // top level, which resolves to nothing at run time. This is the case that
    // proved a relation needs a destination.
    expect(relation("@particle-academy/wait")).toBeNull();
    expect(paths("@particle-academy/wait")).toEqual(["waited", "duration", "input"]);
  });

  test("webhook_trigger declares no relation, because its choice is DATA-dependent", () => {
    // `inputs.payload ?? inputs` cannot be answered from config, so no relation
    // is honest. Under-claiming is free.
    expect(relation("@particle-academy/webhook_trigger")).toBeNull();
  });
});
