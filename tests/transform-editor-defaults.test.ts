import { describe, expect, it } from "vitest";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { defaultConfigFor, getNodeKind, validateConfig } from "../src/registry/registry";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph } from "../src/types";

registerBuiltinKinds();

/**
 * The editor's own defaults for `transform` must pass this engine's own validator.
 *
 * `defaultConfigFor(transform)` is `{ mode: "fields", fields: [{ key: "", value: "" }] }`:
 * the editor drops a node with one empty row ready to fill in. `validateConfig`
 * then refused that row ("Key is required"), so NodeConfigPanel showed a warning
 * on a node nobody had touched yet, and every port that mirrors this validator
 * refused the editor's output outright. Reported by Maipa against the Python
 * port; the inconsistency starts here.
 *
 * The executor has always skipped a row with no key, so an untouched row is a
 * placeholder, not a mistake. The fix is to say so in the schema
 * (`skipBlankRows`) rather than to stop validating rows: a row with a VALUE and
 * no key is still refused, because the executor would drop that value silently.
 */
const kind = () => {
  const k = getNodeKind("transform");
  if (!k) throw new Error("transform is not registered");
  return k;
};

const run = async (config: Record<string, unknown>, inputs: unknown) => {
  const graph = {
    nodes: [
      { id: "t", type: "manual_trigger", position: { x: 0, y: 0 }, data: { kind: "manual_trigger", config: {} } },
      { id: "tf", type: "transform", position: { x: 0, y: 0 }, data: { kind: "transform", config } },
    ],
    edges: [{ id: "e1", source: "t", target: "tf" }],
  } as unknown as FlowGraph;

  const result = await runFlow(graph, {}, undefined, { initialInputs: { t: inputs } });
  expect(result.ok, result.error).toBe(true);
  return result.outputs.tf;
};

describe("transform: the editor's defaults are a valid config", () => {
  it("the defaults are exactly what the editor writes", () => {
    expect(defaultConfigFor(kind())).toEqual({ mode: "fields", fields: [{ key: "", value: "" }] });
  });

  it("validates the editor's defaults with no issues", () => {
    expect(validateConfig(kind(), defaultConfigFor(kind()))).toEqual([]);
  });

  it("validates expression mode with the stale default row still present", () => {
    // NodeConfigPanel merges an edited key into the existing config, so picking
    // "One expression" leaves `fields` behind. That row is unused, and blank.
    expect(
      validateConfig(kind(), { mode: "expression", fields: [{ key: "", value: "" }], expression: "{{ $json.a }}" }),
    ).toEqual([]);
  });

  it("validates a row object with no keys at all as blank", () => {
    expect(validateConfig(kind(), { mode: "fields", fields: [{}] })).toEqual([]);
  });

  it("still refuses a row with a value and no key, which the executor would drop", () => {
    expect(validateConfig(kind(), { mode: "fields", fields: [{ key: "", value: "{{ $json.a }}" }] })).toEqual([
      { key: "fields", message: "Output fields item 1: Key is required" },
    ]);
  });

  it("still refuses an unknown mode", () => {
    expect(validateConfig(kind(), { mode: "rows", fields: [] })).toEqual([
      { key: "mode", message: "Build the output must be one of fields, expression" },
    ]);
  });

  it("still refuses the wrong types", () => {
    expect(validateConfig(kind(), { mode: "fields", fields: "name" })).toEqual([
      { key: "fields", message: "Output fields must be a list" },
    ]);
    expect(validateConfig(kind(), { mode: "fields", fields: ["name"] })).toEqual([
      { key: "fields", message: "Output fields item 1 must be an object" },
    ]);
    expect(validateConfig(kind(), { mode: "expression", expression: 5 })).toEqual([
      { key: "expression", message: "Expression (advanced) must be a string" },
    ]);
  });

  it("does not treat a blank row as skippable on a repeater that did not opt in", () => {
    // `branch` evaluates every condition row it is given, blank or not, so its
    // validator must keep refusing one.
    const branch = getNodeKind("branch")!;
    const issues = validateConfig(branch, { conditions: [{ left: "", right: "" }] });
    expect(issues.map((i) => i.key)).toContain("conditions");
  });
});

/**
 * Admission judges a key's blankness exactly as the executor does: TRIMMED.
 *
 * `{ key: "   ", value: "Configured synthetic value" }` passed `validateConfig`
 * (the check compared the key with `""`), imported cleanly, and then ran as a
 * passthrough, because `transformRows` trims the key, finds it blank and skips
 * the row. The configured value vanished without a word. Reported by Maipa
 * against the published 0.82.0.
 */
describe("transform: a whitespace-only key is blank, in the validator as in the executor", () => {
  it("refuses a whitespace-only key with a value, with the empty-key message", () => {
    expect(
      validateConfig(kind(), { mode: "fields", fields: [{ key: "   ", value: "Configured synthetic value" }] }),
    ).toEqual([{ key: "fields", message: "Output fields item 1: Key is required" }]);
  });

  it("refuses every whitespace the executor trims away, not only spaces", () => {
    for (const key of ["\t", "\n", " \r\n ", String.fromCharCode(0x00a0), String.fromCharCode(0x2003), String.fromCharCode(0xfeff), String.fromCharCode(0x3000)]) {
      expect(key.trim()).toBe("");
      expect(validateConfig(kind(), { mode: "fields", fields: [{ key, value: "x" }] }), JSON.stringify(key)).toEqual([
        { key: "fields", message: "Output fields item 1: Key is required" },
      ]);
    }
  });

  it("skips a whitespace-only key with an empty value as a blank row", () => {
    expect(validateConfig(kind(), { mode: "fields", fields: [{ key: "   ", value: "" }] })).toEqual([]);
    expect(validateConfig(kind(), { mode: "fields", fields: [{ key: "\t" }] })).toEqual([]);
  });

  it("admits a padded non-blank key", () => {
    expect(validateConfig(kind(), { mode: "fields", fields: [{ key: "  name ", value: "{{ $json.first }}" }] })).toEqual(
      [],
    );
  });

  it("keeps judging the value untrimmed: a whitespace value is a value", () => {
    // Only the key is trimmed by the executor. A value of spaces is written as
    // spaces under a real key, so it is admitted there -- and with no key it is
    // a value that would be lost, so it is refused.
    expect(validateConfig(kind(), { mode: "fields", fields: [{ key: "pad", value: "  " }] })).toEqual([]);
    expect(validateConfig(kind(), { mode: "fields", fields: [{ key: "", value: "  " }] })).toEqual([
      { key: "fields", message: "Output fields item 1: Key is required" },
    ]);
  });

  it("does not trim on a repeater that did not opt in to skipping blank rows", () => {
    // Trimming is part of `skipBlankRows`' contract with the executor that
    // declares it. `user_input`'s rows have a required text `key` too, but it
    // declares no such thing, so its admission is untouched by this fix.
    const userInput = getNodeKind("user_input")!;
    const issues = validateConfig(userInput, { fields: [{ key: "  ", label: "Your answer", type: "text" }] });
    expect(issues).toEqual([]);
  });

  it("runs a padded key under the trimmed key, keeping its value", async () => {
    expect(await run({ mode: "fields", fields: [{ key: "  name ", value: "{{ $json.first }}" }] }, { first: "Ada" })).toEqual(
      { name: "Ada" },
    );
  });

  it("leaves expression mode alone: a stale whitespace-key row there is not validated away or applied", async () => {
    const config = { mode: "expression", fields: [{ key: "", value: "" }], expression: "{{ $json.first }}" };
    expect(validateConfig(kind(), config)).toEqual([]);
    expect(await run(config, { first: "Ada" })).toBe("Ada");
  });
});

describe("transform: `emits` follows the path the executor takes", () => {
  const emits = (config: Record<string, unknown>) =>
    (kind().emits as (c: Record<string, unknown>) => string | null)(config);

  it("claims `input` only when the input really passes through", () => {
    expect(emits(defaultConfigFor(kind()))).toBe("input");
    expect(emits({ mode: "expression", expression: "   " })).toBe("input");
  });

  it("claims the expression only when the expression path runs", () => {
    expect(emits({ mode: "expression", expression: "{{ $json.a }}", fields: [{ key: "x", value: "1" }] })).toBe(
      "expression:expression",
    );
    // An explicit fields mode ignores a stale expression, so `emits` must too.
    expect(emits({ mode: "fields", fields: [{ key: "x", value: "1" }], expression: "{{ $json.a }}" })).toBeNull();
  });

  it("claims no relation for a built object, which is neither the input nor an expression", () => {
    expect(emits({ mode: "fields", fields: [{ key: "x", value: "{{ $json.a }}" }] })).toBeNull();
  });
});

describe("transform: the editor's defaults run", () => {
  it("passes the input through for the untouched default", async () => {
    expect(await run(defaultConfigFor(kind()), { a: 1 })).toEqual({ a: 1 });
  });

  it("builds the object from real rows, skipping the blank one", async () => {
    expect(
      await run(
        { mode: "fields", fields: [{ key: "", value: "" }, { key: "name", value: "{{ $json.first }}" }, { key: "n", value: 3 }] },
        { first: "Ada" },
      ),
    ).toEqual({ name: "Ada", n: 3 });
  });

  it("skips a row that is not an object instead of failing the node", async () => {
    // `row.key` on a null row threw a TypeError and failed the run. The
    // validator already refuses such a row; the executor should not crash on it.
    expect(await run({ mode: "fields", fields: [null, "x", { key: "b", value: "{{ $json.a }}" }] }, { a: 1 })).toEqual({
      b: 1,
    });
  });
});
