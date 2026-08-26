/**
 * "Did not resolve" must be distinguishable from "resolved to empty".
 *
 * `resolvePath` returns `null` both for a path that does not exist and for a
 * path that exists holding `null`. At the interpolation layer that collapse
 * gets worse, because `null` stringifies to `""`. The consumer who reported it
 * put it exactly:
 *
 *   > "An unresolvable path yields `''`, so a wrong field is indistinguishable
 *   > from an empty one at runtime."
 *
 * A misspelled field renders as an empty string, which looks precisely like a
 * field that is legitimately empty. The graph runs, the node succeeds, and the
 * output is quietly missing a value nobody is told about. Worst on LLM-authored
 * graphs, where the field name was guessed to begin with.
 *
 * Same shape as the four `??` collapses fixed across all four runtimes on
 * 2026-08-26 (absent vs null), one layer up.
 *
 * `tryResolvePath` adds the second return channel; the `onUnresolved` policy is
 * OPT-IN, default unchanged, at the reporting consumer's request.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateConfig,
  evaluateExpression,
  resolvePath,
  tryResolvePath,
  UnresolvedPathError,
} from "../src/expressions/expr";

const ctx = {
  in: { text: "hello", empty: "", nothing: null, count: 0 },
  n1: { nested: { deep: "found" } },
};

describe("tryResolvePath separates the two states resolvePath collapses", () => {
  it("reports a missing path as unresolved", () => {
    expect(tryResolvePath("in.missing", ctx)).toEqual({ resolved: false, value: null });
  });

  it("reports a path holding NULL as RESOLVED", () => {
    // The whole point. `resolvePath` cannot tell these two apart; both give null.
    expect(tryResolvePath("in.nothing", ctx)).toEqual({ resolved: true, value: null });
    expect(resolvePath("in.nothing", ctx)).toBe(resolvePath("in.missing", ctx));
  });

  it("reports a path holding an EMPTY STRING as resolved", () => {
    expect(tryResolvePath("in.empty", ctx)).toEqual({ resolved: true, value: "" });
  });

  it("reports a path holding ZERO as resolved", () => {
    // Zero is the classic falsy-but-present value; `resolved` must not be
    // computed from truthiness anywhere.
    expect(tryResolvePath("in.count", ctx)).toEqual({ resolved: true, value: 0 });
  });

  it("treats walking into a scalar or a null as unresolved", () => {
    expect(tryResolvePath("in.text.nope", ctx).resolved).toBe(false);
    expect(tryResolvePath("in.nothing.nope", ctx).resolved).toBe(false);
  });

  it("resolves through nesting and the $json alias", () => {
    expect(tryResolvePath("n1.nested.deep", ctx)).toEqual({ resolved: true, value: "found" });
    expect(tryResolvePath("$json.text", ctx)).toEqual({ resolved: true, value: "hello" });
    expect(tryResolvePath("$input.text", ctx)).toEqual({ resolved: true, value: "hello" });
  });

  it("treats an empty path as unresolved", () => {
    expect(tryResolvePath("   ", ctx).resolved).toBe(false);
  });
});

describe("resolvePath is unchanged", () => {
  // It is now DEFINED in terms of tryResolvePath, so this pins that the
  // delegation did not alter a single answer. Two copies of a traversal agree
  // right up until someone edits one of them.
  it("still collapses both states to null", () => {
    expect(resolvePath("in.missing", ctx)).toBeNull();
    expect(resolvePath("in.nothing", ctx)).toBeNull();
    expect(resolvePath("in.text", ctx)).toBe("hello");
    expect(resolvePath("in.count", ctx)).toBe(0);
    expect(resolvePath("$json.text", ctx)).toBe("hello");
  });
});

describe('the default policy is "empty" — nothing changes for existing hosts', () => {
  it("interpolates an unresolvable path to nothing", () => {
    expect(evaluateExpression("Hi {{ in.missing }}!", ctx)).toBe("Hi !");
  });

  it("returns null for a whole expression that does not resolve", () => {
    expect(evaluateExpression("{{ in.missing }}", ctx)).toBeNull();
  });

  it("is what you get when no options are passed at all", () => {
    expect(evaluateExpression("{{ in.missing }}", ctx)).toBe(
      evaluateExpression("{{ in.missing }}", ctx, { onUnresolved: "empty" }),
    );
  });
});

describe('the "keep" policy makes the failure visible instead of invisible', () => {
  it("leaves the template text in place when interpolating", () => {
    expect(evaluateExpression("Hi {{ in.missing }}!", ctx, { onUnresolved: "keep" })).toBe(
      "Hi {{ in.missing }}!",
    );
  });

  it("reproduces the original spacing exactly", () => {
    // The reconstruction uses the RAW inner text, so a round-trip is
    // byte-identical -- a "kept" template that came back subtly reformatted
    // would be its own small lie.
    const t = "a {{in.missing}} b {{   in.missing   }} c";
    expect(evaluateExpression(t, ctx, { onUnresolved: "keep" })).toBe(t);
  });

  it("returns the whole template for a whole expression", () => {
    expect(evaluateExpression("{{ in.missing }}", ctx, { onUnresolved: "keep" })).toBe(
      "{{ in.missing }}",
    );
  });

  it("still substitutes the paths that DO resolve", () => {
    // NOTE the leading "x". Without it this string starts with `{{` and ends
    // with `}}`, which makes it a WHOLE expression -- see the corner pinned
    // below. My first draft of this test omitted it and asserted the wrong
    // answer; the code was right.
    expect(
      evaluateExpression("x {{ in.text }} / {{ in.missing }}", ctx, { onUnresolved: "keep" }),
    ).toBe("x hello / {{ in.missing }}");
  });

  it("makes the documented `{{a}}{{b}}` corner VISIBLE rather than silently null", () => {
    // A template that both starts with `{{` and ends with `}}` is one whole
    // expression whose path contains the inner `}}{{` -- deliberate, inherited
    // from the `$`-anchored regex this scanner replaced, and mirrored in PHP.
    //
    // Under the default policy that path resolves to `null`, so an author who
    // wrote two expressions and got one null has nothing to go on. Under
    // "keep" the original text comes back, which at least SHOWS them the
    // template was never split. That is the policy earning its keep on a case
    // it was not designed for.
    const twoLooking = "{{ in.text }} / {{ in.text }}";
    expect(evaluateExpression(twoLooking, ctx)).toBeNull();
    expect(evaluateExpression(twoLooking, ctx, { onUnresolved: "keep" })).toBe(twoLooking);
  });

  it("does NOT keep a path that resolved to null or empty", () => {
    // The distinction this whole change exists for: a resolved-but-empty value
    // interpolates to nothing under every policy. Only UNRESOLVED is special.
    expect(evaluateExpression("[{{ in.nothing }}]", ctx, { onUnresolved: "keep" })).toBe("[]");
    expect(evaluateExpression("[{{ in.empty }}]", ctx, { onUnresolved: "keep" })).toBe("[]");
  });
});

describe('the "throw" policy refuses rather than delivering a silent hole', () => {
  it("throws for an unresolvable path, naming it", () => {
    expect(() => evaluateExpression("Hi {{ in.missing }}", ctx, { onUnresolved: "throw" })).toThrow(
      UnresolvedPathError,
    );
    expect(() => evaluateExpression("Hi {{ in.missing }}", ctx, { onUnresolved: "throw" })).toThrow(
      /in\.missing/,
    );
  });

  it("throws for a whole expression too", () => {
    expect(() => evaluateExpression("{{ in.missing }}", ctx, { onUnresolved: "throw" })).toThrow(
      UnresolvedPathError,
    );
  });

  it("carries the path as a property, not only in the message", () => {
    try {
      evaluateExpression("{{ in.missing }}", ctx, { onUnresolved: "throw" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnresolvedPathError);
      expect((e as UnresolvedPathError).path.trim()).toBe("in.missing");
    }
  });

  it("does NOT throw for a path that resolved to null or empty", () => {
    expect(evaluateExpression("[{{ in.nothing }}]", ctx, { onUnresolved: "throw" })).toBe("[]");
    expect(evaluateExpression("[{{ in.empty }}]", ctx, { onUnresolved: "throw" })).toBe("[]");
    expect(evaluateExpression("{{ in.count }}", ctx, { onUnresolved: "throw" })).toBe(0);
  });
});

describe("evaluateConfig forwards the policy", () => {
  it("applies it through nesting and arrays", () => {
    const config = {
      url: "https://x/{{ in.missing }}",
      nested: { body: "{{ in.missing }}" },
      list: ["{{ in.missing }}", "{{ in.text }}"],
    };

    expect(evaluateConfig(config, ctx, { onUnresolved: "keep" })).toEqual({
      url: "https://x/{{ in.missing }}",
      nested: { body: "{{ in.missing }}" },
      list: ["{{ in.missing }}", "hello"],
    });
  });

  it("defaults to the existing behaviour", () => {
    expect(evaluateConfig({ url: "https://x/{{ in.missing }}" }, ctx)).toEqual({ url: "https://x/" });
  });

  it("throws from inside a nested value under the throw policy", () => {
    expect(() =>
      evaluateConfig({ nested: { body: "{{ in.missing }}" } }, ctx, { onUnresolved: "throw" }),
    ).toThrow(UnresolvedPathError);
  });
});
