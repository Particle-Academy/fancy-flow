/**
 * Getting back to the builtin after replacing it.
 *
 * ## Why this exists — a regression 0.66.2 shipped and its changelog denied
 *
 * 0.66.2 stopped builtin registration from clobbering a host's replacement.
 * That was the right fix, and it silently broke a use nobody had written down:
 * **`registerBuiltinKinds()` was how people reset the registry between tests.**
 * Before, it restored the builtins over any override; after, it correctly
 * refuses to, so an override leaks from one test into the next.
 *
 * It does not fail loudly. It fails as a wrong assertion in a LATER, unrelated
 * test — the most expensive shape a test failure can take, because the thing
 * that broke and the thing that reports are different tests.
 *
 * The 0.66.2 changelog said "Nothing to do." That was wrong, and a consumer hit
 * it within the hour and had to invent their own snapshot-and-restore.
 *
 * The other half is that the release notes claimed "unregistering releases the
 * claim" — true of the closure `registerNodeKind` returns, and undiscoverable:
 * there was no named export, so a consumer reading the export list correctly
 * concluded no such operation existed.
 *
 * So: a named, discoverable way back, that restores the builtin rather than
 * just deleting the entry.
 */
import { beforeEach, describe, expect, test } from "vitest";
import {
  getNodeKind,
  listNodeKinds,
  registerNodeKind,
  resetNodeKindsForTests,
  unregisterNodeKind,
} from "../src/registry/registry";
import { registerBuiltinKinds } from "../src/registry/builtin";

const keysOf = (name: string) => (getNodeKind(name)?.configSchema ?? []).map((f) => f.key);

function overrideLlmCall() {
  registerNodeKind({
    ...getNodeKind("llm_call")!,
    configSchema: [{ type: "select", key: "power_level", label: "Power Level" }],
  } as never);
}

beforeEach(() => {
  resetNodeKindsForTests();
  registerBuiltinKinds();
});

describe("unregisterNodeKind", () => {
  test("restores the BUILTIN, not merely deleting the kind", () => {
    // Deleting would leave `llm_call` absent, which is a different and worse
    // state than before the override: the canvas renders raw kind ids and the
    // palette loses the node entirely.
    const original = keysOf("llm_call");
    expect(original.length).toBeGreaterThan(1);

    overrideLlmCall();
    expect(keysOf("llm_call")).toEqual(["power_level"]);

    unregisterNodeKind("llm_call");

    expect(keysOf("llm_call")).toEqual(original);
  });

  test("releases the claim, so builtin registration owns the name again", () => {
    // The claim is the whole mechanism 0.66.2 added. If unregistering left it
    // set, the caller would be back to a name nothing can write.
    overrideLlmCall();
    unregisterNodeKind("llm_call");

    registerBuiltinKinds();

    expect(keysOf("llm_call").length).toBeGreaterThan(1);
  });

  test("works through an alias, like every other registry call", () => {
    overrideLlmCall();

    // `llm_call` is the bare alias; the canonical id is namespaced.
    unregisterNodeKind("@particle-academy/llm_call");

    expect(keysOf("llm_call").length).toBeGreaterThan(1);
  });

  test("removes a host kind that has no builtin behind it", () => {
    registerNodeKind({ name: "@acme/thing", category: "io", label: "Thing" } as never);
    expect(getNodeKind("@acme/thing")).toBeDefined();

    unregisterNodeKind("@acme/thing");

    // `getNodeKind` returns null, not undefined, for an absent kind.
    expect(getNodeKind("@acme/thing")).toBeNull();
  });

  test("reports whether it released anything", () => {
    // A silent no-op on a typo'd name is how a test-isolation helper stops
    // isolating without anyone noticing — the exact class this file is about.
    overrideLlmCall();

    expect(unregisterNodeKind("llm_call")).toBe(true);
    expect(unregisterNodeKind("llm_call"), "second call released something again").toBe(false);
    expect(unregisterNodeKind("@acme/never_registered")).toBe(false);
  });

  test("leaves other kinds alone", () => {
    overrideLlmCall();
    const routerBefore = keysOf("llm_router");

    unregisterNodeKind("llm_call");

    expect(keysOf("llm_router")).toEqual(routerBefore);
    expect(listNodeKinds().length).toBeGreaterThan(25);
  });
});

describe("the test-isolation path consumers actually need", () => {
  test("unregister restores isolation that registerBuiltinKinds no longer provides", () => {
    // This is the consumer's scenario, start to finish: override in one test,
    // and be genuinely back to the builtin at the start of the next.
    overrideLlmCall();
    expect(keysOf("llm_call")).toEqual(["power_level"]);

    // What a `beforeEach` should now do:
    unregisterNodeKind("llm_call");

    expect(keysOf("llm_call")).not.toContain("power_level");
    expect(keysOf("llm_call")).toContain("model");
  });

  test("registerBuiltinKinds ALONE does not restore an override — pinning the 0.66.2 behaviour change", () => {
    // Deliberately asserts the thing that surprised a consumer, so it is
    // documented in code rather than only in a changelog nobody re-reads. If
    // this ever flips back, the 0.66.2 fix has been undone.
    overrideLlmCall();

    registerBuiltinKinds();

    expect(keysOf("llm_call")).toEqual(["power_level"]);
  });
});
