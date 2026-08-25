/**
 * Workflow props — the shared table, run against THIS side.
 *
 * ## Why this file exists later than it should have
 *
 * `src/runtime/workflow-props.ts` already said, in its own docblock, that
 * `suites/flow/workflow-props` in `@particle-academy/fancy-conformance` "is the
 * table all three run". **It wasn't.** The PHP and Python twins ran it; nothing
 * on this side imported it, so the runtime whose behaviour the goldens describe
 * was the one runtime not checked against them.
 *
 * Two things hid it. The claim was PROSE beside the code rather than a check —
 * the same shape as a hand-maintained list that nobody updates. And the devDep
 * was pinned at `^0.4.0` while the corpus had moved to 0.11.x, so the suite was
 * not even present in the installed tarball: a test importing it would have
 * failed at import, which is presumably why one was never written. A caret on a
 * `0.x` devDep locks the MINOR, so the pin sat eight releases back while looking
 * deliberate.
 *
 * The lesson is the repository's own: **prose adjacent to a check is not the
 * check**, and a version range that cannot advance is a dependency nobody is
 * updating.
 */
import { describe, expect, it } from "vitest";
import CASES from "@particle-academy/fancy-conformance/suites/flow/workflow-props/cases.json" with { type: "json" };
import { resolveWorkflowProps } from "../src/runtime/workflow-props";

type Case = {
  id: string;
  title: string;
  skip?: Record<string, string>;
  input: {
    declared?: Array<Record<string, unknown>>;
    passed?: Record<string, unknown>;
  };
  expected:
    | { ok: true; props: Record<string, unknown> }
    | { ok: false; code: string };
};

const cases = (CASES as { cases: Case[] }).cases;

describe("flow/workflow-props", () => {
  // The vacuity guard, and here it is not theoretical: this whole file was
  // absent because the installed tarball did not carry the suite. An empty
  // `cases` array would restore exactly that state while printing green.
  it("loaded the shared table", () => {
    expect(cases.length).toBeGreaterThan(15);
  });

  for (const c of cases) {
    const runner = c.skip?.node ? it.skip : it;

    runner(`${c.id} — ${c.title}`, () => {
      const result = resolveWorkflowProps(
        c.input.declared as never,
        c.input.passed,
      );

      expect(result.ok).toBe(c.expected.ok);

      if (c.expected.ok) {
        expect(result.ok && result.props).toEqual(c.expected.props);
      } else {
        // The CODE is asserted, not the message. A message is prose that will
        // be reworded; a code is the contract a caller can branch on, and it is
        // what the other two runtimes can be held to without matching an em
        // dash. (An earlier suite in this corpus asserted a substring and hid a
        // live divergence where Python emitted an ASCII hyphen for an em dash.)
        expect(!result.ok && result.code).toBe(c.expected.code);
      }
    });
  }
});
