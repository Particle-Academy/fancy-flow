import type { WorkflowInput } from "../types";

/**
 * Resolving what a caller passed against what a workflow declared.
 *
 * Kept in its own module, and deliberately a pure function over two plain
 * objects, because the PHP and Python runtimes implement the same rules and
 * `suites/flow/workflow-props` in `@particle-academy/fancy-conformance` is the
 * table all three run. A rule that lives inside a runner is a rule each runtime
 * re-derives; a rule that is a function over maps is one they can share a
 * fixture for.
 *
 * ## Every branch here exists to make a mistake LOUD
 *
 * The failure this replaces was silence. `initialInputs` was keyed by node id,
 * so a caller passed `{ t: { topic: "otters" } }` and had to know the trigger
 * was named `t`; and nothing declared what a workflow accepted, so a
 * misspelled key was not an error — the value sat unread, the node saw
 * nothing, and the run reported success with output that was quietly wrong.
 *
 * So: an unknown key fails, a missing required value fails, and a wrong type
 * fails. None of those is a warning. A warning on a queue worker is a line in a
 * log nobody opens.
 */

/**
 * Why a resolution failed, in a vocabulary that is the same in every runtime.
 *
 * The MESSAGE is English prose and each runtime words it slightly differently,
 * which is fine for a human and useless for a shared fixture table. The CODE is
 * what `suites/flow/workflow-props` asserts, so parity is pinned on the
 * decision rather than on the phrasing — otherwise the three implementations
 * would be held to a translation instead of a behaviour.
 */
export type PropsErrorCode = "unknown_input" | "missing_required" | "type_mismatch";

/** The outcome of checking a caller's props against a declaration. */
export type PropsResolution =
  | { ok: true; props: Record<string, unknown> }
  | { ok: false; code: PropsErrorCode; error: string };

/**
 * The runtime type of a value, in the vocabulary a declaration uses.
 *
 * Arrays are checked before objects because `typeof []` is `"object"` and a
 * declaration that says `array` means a list — accepting `{}` there would be
 * the check passing while meaning nothing.
 */
function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Check and fill a caller's props.
 *
 * Returns the resolved map — declared defaults filled in, nothing else added —
 * or the first error. One error rather than a list, because a run stops at the
 * first one anyway and a caller fixing a call wants the thing to fix, not a
 * report.
 */
export function resolveWorkflowProps(
  declared: WorkflowInput[] | undefined,
  passed: Record<string, unknown> | undefined,
): PropsResolution {
  const inputs = declared ?? [];
  const given = passed ?? {};
  const byName = new Map(inputs.map((input) => [input.name, input]));

  // UNKNOWN KEYS FIRST, and this is the check the whole feature is for.
  //
  // A caller who misspells `topic` as `topik` has configured nothing, and
  // before this the run went ahead and looked fine. Checking it before
  // anything else means the error names what they typed rather than
  // complaining that the thing they thought they passed is missing.
  for (const name of Object.keys(given)) {
    if (!byName.has(name)) {
      const known = inputs.map((input) => input.name);
      const suffix = known.length === 0
        ? "this workflow declares no inputs"
        : `known inputs: ${known.join(", ")}`;

      return {
        ok: false,
        code: "unknown_input",
        error: `Unknown workflow input "${name}" — ${suffix}.`,
      };
    }
  }

  const resolved: Record<string, unknown> = {};

  for (const input of inputs) {
    // `hasOwnProperty`, not a truthiness or `??` check. `0`, `false` and `""`
    // are real values a caller meant to pass, and a default applied over them
    // is a silent override — a limit of 0 quietly becoming 10 is not an error
    // anybody sees.
    const supplied = Object.prototype.hasOwnProperty.call(given, input.name);
    const hasDefault = Object.prototype.hasOwnProperty.call(input, "default");

    if (!supplied) {
      if (hasDefault) {
        resolved[input.name] = input.default;
        continue;
      }

      if (input.required) {
        return {
          ok: false,
          code: "missing_required",
          error: `Missing required workflow input "${input.name}"${
            input.type ? ` (${input.type})` : ""
          }.`,
        };
      }

      // Not supplied, no default, not required — absent rather than
      // `undefined`, so `{{ $props.x }}` resolves to null on both runtimes
      // instead of one of them inventing a key.
      continue;
    }

    const value = given[input.name];

    // An undeclared type accepts anything. "I am not asserting a shape" must
    // not degrade into "nothing is allowed".
    if (input.type !== undefined) {
      const actual = typeOf(value);
      if (actual !== input.type) {
        return {
          ok: false,
          code: "type_mismatch",
          error: `Workflow input "${input.name}" expects ${input.type}, got ${actual}.`,
        };
      }
    }

    resolved[input.name] = value;
  }

  return { ok: true, props: resolved };
}
