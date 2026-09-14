/**
 * A template that starts with `{{` and ends with `}}` but holds more than one
 * reference (fancy-flow-php#16).
 *
 * `wholeExpression` used to ask only whether the trimmed template starts with
 * `{{` and ends with `}}`, so `{{ in.text }} --- {{ user.transcript }}` was ONE
 * path, `in.text }} --- {{ user.transcript`, which resolves to nothing. The
 * template returned null under "empty", itself under "keep", and threw under
 * "throw". A consumer's document node wrote nothing, with every reference valid.
 *
 * It was documented as a deliberate corner, inherited from PHP's end-anchored
 * regex and mirrored in all four runtimes, which is why no parity table could
 * catch it. The whole-string branch now applies only to exactly ONE expression;
 * anything else interpolates. Ported from fancy-flow-php 0.52.2's
 * `TemplateWithSeveralReferencesTest`.
 */
import { describe, expect, it } from "vitest";
import { evaluateExpression, UnresolvedPathError, type UnresolvedPolicy } from "../src/expressions/expr";

const ctx = {
  in: { text: "SUMMARY" },
  user: { transcript: "TRANSCRIPT", title: "Call" },
  a: 1,
  b: 2,
};

const policies: UnresolvedPolicy[] = ["empty", "keep", "throw"];

describe.each(policies)('a template with several references, under "%s"', (onUnresolved) => {
  it("interpolates every reference of a template that starts and ends with one", () => {
    expect(
      evaluateExpression("{{ in.text }}\n\n---\n\n## Original\n\n{{ user.transcript }}", ctx, { onUnresolved }),
    ).toBe("SUMMARY\n\n---\n\n## Original\n\nTRANSCRIPT");
    expect(evaluateExpression("{{ user.title }} - {{ in.text }}", ctx, { onUnresolved })).toBe("Call - SUMMARY");
    expect(evaluateExpression("Summary: {{ in.text }} --- {{ user.transcript }}", ctx, { onUnresolved })).toBe(
      "Summary: SUMMARY --- TRANSCRIPT",
    );
    // Adjacent references are two references, not one path spanning `}}{{`.
    expect(evaluateExpression("{{ a }}{{ b }}", ctx, { onUnresolved })).toBe("12");
  });

  it("still returns the typed value for exactly one expression", () => {
    expect(evaluateExpression("{{ in.text }}", ctx, { onUnresolved })).toBe("SUMMARY");
    expect(evaluateExpression(" {{ a }} ", ctx, { onUnresolved })).toBe(1);
  });

  it("does not read an inner `{{` as part of one expression either", () => {
    // The rule's second condition. `{{ a {{ b }}` is malformed; the scan pairs
    // the first `{{` with the first `}}`, and that path does not resolve, so
    // each policy applies to it as an interpolated reference -- never the
    // whole-string branch's null.
    const malformed = "{{ a {{ b }}";
    if (onUnresolved === "throw") {
      expect(() => evaluateExpression(malformed, ctx, { onUnresolved })).toThrow(UnresolvedPathError);
    } else {
      expect(evaluateExpression(malformed, ctx, { onUnresolved })).toBe(onUnresolved === "keep" ? malformed : "");
    }
  });
});

describe("the policy applies per reference when one of several does not resolve", () => {
  const template = "{{ in.text }} / {{ in.nope }}";

  it("empties only the unresolved reference by default", () => {
    expect(evaluateExpression(template, ctx)).toBe("SUMMARY / ");
  });

  it("keeps only the unresolved reference's text", () => {
    expect(evaluateExpression(template, ctx, { onUnresolved: "keep" })).toBe("SUMMARY / {{ in.nope }}");
  });

  it("throws naming the unresolved reference, not the whole template", () => {
    let caught: unknown;
    try {
      evaluateExpression(template, ctx, { onUnresolved: "throw" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnresolvedPathError);
    expect((caught as UnresolvedPathError).path.trim()).toBe("in.nope");
  });
});
