/**
 * A host's replacement of a builtin kind must SURVIVE builtin registration.
 *
 * ## The bug this pins, reported from production
 *
 * A consumer extends a builtin's `configSchema` — drops the fields their
 * platform manages centrally, adds their own — by registering a full
 * definition under the builtin's name. That is the only mechanism we offer for
 * it, and it works.
 *
 * Then `registerBuiltinKinds()` runs again and silently puts the original back.
 * No error, no warning, no way to notice except that a field vanishes from the
 * editor. Their runtime keeps validating against the extended schema, so the
 * two disagree and only the editor is wrong — which surfaces as a field that
 * exists, runs, and cannot be authored.
 *
 * **It is ordering-dependent, which is what makes it vicious.** Since 0.66.1
 * the root barrel calls `registerBuiltinKinds()` at import time (moved there so
 * `/engine` could stay React-free). So whether a consumer's override survives
 * depends on which module their bundler happens to evaluate second — a property
 * no consumer can see, test, or control, and which can change under them when
 * an unrelated import is added.
 *
 * ## Why the fix is not "call it earlier"
 *
 * That is advice, not a guarantee, and it puts the burden on every consumer
 * forever. The registry already knew about this exact failure mode and had
 * solved it for the OTHER extension point: `overrides` is deliberately kept in
 * a separate map so a presentation patch survives its base kind being
 * re-registered. The comment there says so in as many words. Behavioural
 * replacement had the identical problem and no protection.
 *
 * So the fix makes builtin registration refuse to overwrite a registration a
 * HOST made, rather than asking hosts to sequence their imports correctly.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  getNodeKind,
  listNodeKinds,
  registerNodeKind,
  resetNodeKindsForTests,
} from "../src/registry/registry";
import { registerBuiltinKinds } from "../src/registry/builtin";

/** The consumer's shape: keep most of the builtin, drop some, add one. */
function extendLlmCall() {
  const builtin = getNodeKind("llm_call");
  if (!builtin) throw new Error("no builtin llm_call to extend");

  const drop = new Set(["provider", "model", "temperature", "top_p", "max_tokens", "tools", "credential"]);

  return registerNodeKind({
    ...builtin,
    configSchema: [
      ...(builtin.configSchema ?? []).filter((f) => !drop.has(f.key)),
      { type: "select", key: "power_level", label: "Power Level", options: [{ value: "max", label: "Max" }] },
    ],
  } as never);
}

const keysOf = (name: string) => (getNodeKind(name)?.configSchema ?? []).map((f) => f.key);

beforeEach(() => {
  resetNodeKindsForTests();
  registerBuiltinKinds();
});

describe("a host replacement of a builtin", () => {
  test("takes effect, and the PALETTE sees it", () => {
    // `getNodeKind` alone is not the claim: the editor builds its palette from
    // `listNodeKinds`, so an override visible to one and not the other would
    // still leave the field unauthorable.
    extendLlmCall();

    expect(keysOf("llm_call")).toContain("power_level");
    expect(keysOf("llm_call")).not.toContain("model");

    const listed = listNodeKinds().find((k) => k.name === "@particle-academy/llm_call");
    expect((listed?.configSchema ?? []).map((f) => f.key)).toContain("power_level");
  });

  test("SURVIVES a later registerBuiltinKinds()", () => {
    extendLlmCall();

    registerBuiltinKinds();

    expect(
      keysOf("llm_call"),
      "a later registerBuiltinKinds() reverted the host's kind — this is the production bug",
    ).toContain("power_level");
  });

  test("survives the root barrel being imported after it", async () => {
    // The real-world trigger, not a synthetic one: importing the package root
    // runs `registerBuiltinKinds()` as a top-level side effect. A consumer
    // cannot control when their bundler does that.
    extendLlmCall();

    await import("../src/index");

    expect(keysOf("llm_call")).toContain("power_level");
  });

  test("is still replaceable by the host a second time", () => {
    // Protecting host registrations must not make them immutable — HMR and a
    // consumer's own re-registration both depend on replacing their own entry.
    extendLlmCall();

    registerNodeKind({
      ...getNodeKind("llm_call")!,
      configSchema: [{ type: "text", key: "second_pass", label: "Second" }],
    } as never);

    expect(keysOf("llm_call")).toEqual(["second_pass"]);
  });

  test("does not leak into an unrelated kind", () => {
    extendLlmCall();

    expect(keysOf("llm_router")).not.toContain("power_level");
    expect(keysOf("branch")).not.toContain("power_level");
  });
});

describe("builtin registration still does its own job", () => {
  test("re-registering upgrades builtins the host has NOT touched", () => {
    // The four kinds with renderers are registered twice on purpose — the
    // React-free table first, then decorated. Refusing to overwrite anything
    // would break that, so the guard must distinguish "a host owns this" from
    // "a builtin owns this".
    resetNodeKindsForTests();
    registerBuiltinKinds();

    const lane = getNodeKind("lane");
    expect(lane, "builtins did not register at all").toBeDefined();
    expect(lane?.component, "the renderer decoration was lost").toBeDefined();
  });

  test("registers the whole vocabulary, not a subset", () => {
    // Vacuity: every assertion above would pass against an empty registry that
    // simply never overwrote anything.
    expect(listNodeKinds().length).toBeGreaterThan(25);
  });
});
