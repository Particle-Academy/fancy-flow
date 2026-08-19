import { describe, expect, it } from "vitest";
import { RunIdentity } from "../src/runtime/run-identity";
// From the INSTALLED package, for the reason recorded in conformance-expr.test.ts:
// a sibling-checkout path works in one directory layout and silently no-ops in
// every other, CI included.
import CASES from "@particle-academy/fancy-conformance/suites/shared/flow-run-identity/cases.json" with { type: "json" };

/**
 * The three-runtime table for run/step identity, run against THIS side.
 *
 * `fancy-flow-php` and `fancy-flow-py` read the identical rows. Idempotency is
 * exactly the kind of contract that cannot be kept honest by prose: every
 * implementation looks right in isolation, and the failure only appears as a
 * duplicate charge in somebody's ledger.
 */
type Case = {
  id: string;
  title: string;
  fn: string;
  input: Record<string, any>;
  expected: unknown;
  skip?: Record<string, string>;
};

const cases = (CASES as { cases: Case[] }).cases.filter((c) => !c.skip?.node);

const FNS: Record<string, (input: Record<string, any>) => unknown> = {
  stepKey: (i) =>
    new RunIdentity(i.runKey, i.path ?? [], i.attempt ?? 1).stepKey(i.nodeId, i.occurrence),
  isReplaySafe: (i) =>
    new RunIdentity("run_conformance", [], i.attempt, i.firstAttemptAt).isReplaySafe(
      i.windowSeconds,
      i.now,
    ),
};

describe("conformance: shared/flow-run-identity", () => {
  it("has cases, and every one names a function this runner implements", () => {
    expect(cases.length).toBeGreaterThan(20);
    for (const c of cases) {
      expect(FNS[c.fn], `case ${c.id} calls unimplemented fn "${c.fn}"`).toBeTypeOf("function");
    }
  });

  it.each(cases.map((c) => [c.id, c.title, c] as const))("%s %s", (_id, _title, c) => {
    expect(FNS[c.fn]!(c.input)).toEqual(c.expected);
  });
});
