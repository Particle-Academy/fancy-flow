/**
 * Server-sourced config schemas — the overlay that kills the hand-mirror.
 *
 * ## The problem this exists for
 *
 * fancy-flow has two kind registries. The PHP one lets a host decorate a
 * builtin — drop the fields its platform manages centrally, add its own — and
 * that decoration reaches the runtime and validation. **The editor never learns
 * any of it**, because the palette is built client-side from the JS registry.
 *
 * A consumer hit exactly that: a `power_level` field configurable on their
 * server and *unauthorable in the editor*. The field existed, ran, and had no
 * control. Two releases made the existing extension point RELIABLE (0.66.2,
 * 0.66.3) without removing the mirror, which is the difference between a
 * hand-kept list you can trust and not keeping one.
 *
 * ## Why an overlay and not "send the whole kind"
 *
 * Because a kind is not serialisable. `executor`, `component`, `renderBody` and
 * `icon` are functions or React. And the one that actually decides it:
 * **`PortSpec` may be a FUNCTION of config**, and three builtins use that form.
 *
 * I assumed those three were declarative list-expansions, which would have made
 * a data format possible. Two of them are not: `switch_case` does a GROUP-BY
 * with a joined label, and `subflow` branches on a derived mode and `unshift`s,
 * so ordering carries meaning. Expressing that as data means a mini-language
 * with grouping, conditionals and ordering — a second implementation of logic
 * that already exists, in a format nothing type-checks, which is the same
 * disagreement one level down.
 *
 * So: **the server owns what a node is CONFIGURED with; the client keeps what a
 * node DOES.** Not a compromise — every host extension anyone has asked for is
 * a config change.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  applyKindSchemaOverlay,
  getNodeKind,
  listNodeKinds,
  overrideNodeKind,
  resetNodeKindsForTests,
} from "../src/registry/registry";
import { registerBuiltinKinds } from "../src/registry/builtin";

const keysOf = (name: string) => (getNodeKind(name)?.configSchema ?? []).map((f) => f.key);

/** The consumer's real shape: keep some fields, drop several, add one. */
function powerLevelOverlay() {
  const builtin = getNodeKind("llm_call")!;
  const drop = new Set(["provider", "model", "temperature", "top_p", "max_tokens", "tools", "credential"]);

  return applyKindSchemaOverlay([
    {
      kind: "llm_call",
      configSchema: [
        ...(builtin.configSchema ?? []).filter((f) => !drop.has(f.key)),
        { type: "select", key: "power_level", label: "Power Level", options: [{ value: "max", label: "Max" }] },
      ],
    },
  ]);
}

beforeEach(() => {
  resetNodeKindsForTests();
  registerBuiltinKinds();
});

describe("applyKindSchemaOverlay", () => {
  test("replaces a builtin's configSchema, and the PALETTE sees it", () => {
    // `getNodeKind` alone is not the claim. The editor builds its palette from
    // `listNodeKinds`, and a schema visible to one and not the other is exactly
    // the field-with-no-control this exists to fix.
    powerLevelOverlay();

    expect(keysOf("llm_call")).toContain("power_level");
    expect(keysOf("llm_call")).not.toContain("model");

    const listed = listNodeKinds().find((k) => k.name === "@particle-academy/llm_call");
    expect((listed?.configSchema ?? []).map((f) => f.key)).toContain("power_level");
  });

  test("REPLACES rather than merges, so a removal is expressible", () => {
    // The consumer's case is *drop seven fields and add one*. A merge cannot say
    // "remove", and the obvious workaround — a `remove: string[]` beside it — is
    // two mechanisms for one job whose interaction is the next bug.
    powerLevelOverlay();

    for (const gone of ["provider", "model", "temperature", "top_p", "max_tokens", "tools", "credential"]) {
      expect(keysOf("llm_call"), `${gone} survived a replacing overlay`).not.toContain(gone);
    }
  });

  test("SURVIVES a later registerBuiltinKinds()", () => {
    // The 0.66.2 finding, one level up. Builtin registration is not a one-shot
    // event — it is exported, the root barrel calls it at import, and the four
    // decorated kinds are registered twice on purpose. An overlay stored on the
    // kind itself would be reverted by any of those, silently.
    powerLevelOverlay();

    registerBuiltinKinds();

    expect(
      keysOf("llm_call"),
      "a later registerBuiltinKinds() reverted the overlay — it is being stored on the kind rather than beside it",
    ).toContain("power_level");
  });

  test("resolves aliases, like every other registry call", () => {
    applyKindSchemaOverlay([
      { kind: "@particle-academy/llm_call", configSchema: [{ type: "text", key: "canonical_form", label: "C" }] },
    ]);

    expect(keysOf("llm_call")).toEqual(["canonical_form"]);
  });

  test("leaves BEHAVIOUR alone — executor, ports and renderer are untouched", () => {
    // The whole split. If an overlay could reach these, it would be a fork
    // wearing a friendly name and the graph would desync from the runtime.
    const before = getNodeKind("llm_router")!;
    const beforeExec = before.executor;
    const beforeOutputs = before.outputs;

    applyKindSchemaOverlay([{ kind: "llm_router", configSchema: [{ type: "text", key: "x", label: "X" }] }]);

    const after = getNodeKind("llm_router")!;
    expect(after.executor).toBe(beforeExec);
    expect(after.outputs).toBe(beforeOutputs);
    expect(typeof after.outputs).toBe("function"); // still the dynamic form
  });

  test("REPORTS kinds it could not apply instead of dropping them silently", () => {
    // A server listing many kinds will name some the client has not registered.
    // Applying what matches and saying nothing about the rest is how a field
    // goes missing with no error anywhere — the defect this file exists for,
    // reintroduced by its own fix.
    const result = applyKindSchemaOverlay([
      { kind: "llm_call", configSchema: [{ type: "text", key: "a", label: "A" }] },
      { kind: "@acme/not_registered_here", configSchema: [{ type: "text", key: "b", label: "B" }] },
    ]);

    expect(result.applied).toEqual(["@particle-academy/llm_call"]);
    expect(result.unknown).toEqual(["@acme/not_registered_here"]);
  });

  test("unapply restores the builtin schema exactly", () => {
    const original = keysOf("llm_call");

    const { unapply } = powerLevelOverlay();
    expect(keysOf("llm_call")).not.toEqual(original);

    unapply();

    expect(keysOf("llm_call")).toEqual(original);
  });

  test("a presentation override still wins on label", () => {
    // Two patch layers now exist. `overrideNodeKind` is the consumer's explicit
    // local choice about naming; the overlay is the server's schema. The more
    // specific one wins, and it is worth pinning because the composition order
    // is invisible until they disagree.
    applyKindSchemaOverlay([{ kind: "llm_call", label: "From the server" }]);
    overrideNodeKind("llm_call", { label: "From the app" });

    expect(getNodeKind("llm_call")?.label).toBe("From the app");
  });

  test("does not leak into a kind the overlay did not name", () => {
    powerLevelOverlay();

    expect(keysOf("llm_router")).not.toContain("power_level");
    expect(listNodeKinds().length).toBeGreaterThan(25);
  });
});
