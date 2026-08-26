/**
 * `{{ }}` resolution — the TypeScript twin of `FancyFlow\Nodes\Support\Expr`.
 *
 * ## Why this is opt-in and not wired into `runFlow`
 *
 * The PHP runtime resolves expressions inside its batteries-included executors.
 * The JS runtime never has: `runFlow` hands `node.data.config` to your executor
 * verbatim, so every host that uses `{{ }}` today already resolves it itself.
 * Turning resolution on inside `runFlow` would interpolate a second time over
 * values those hosts had already substituted — silently, and only for graphs
 * that happen to contain `{{` in their DATA.
 *
 * So this exports the semantics and changes no behaviour. Call it yourself:
 *
 * ```ts
 * const url = evaluateExpression(node.data.config.url, inputs);
 * ```
 *
 * ## The semantics are the PHP file's, deliberately
 *
 * This is not a general expression language and must not grow into one. It
 * resolves a dot-path against a context and nothing else — no arithmetic, no
 * comparisons, no calls. Hosts that want real expressions override the executor
 * (the PHP docblock points at symfony/expression-language for the same reason).
 *
 * Divergence here is a correctness bug rather than a style difference: the same
 * graph is authored once and may run on either runtime. `suites/shared/expr`
 * in `@particle-academy/fancy-conformance` is the fixture table both sides run,
 * so parity is a test result instead of a claim.
 */

/** Anything a context or a resolved value can be. */
export type ExprValue = unknown;

/** The context an expression resolves against — the executor's `inputs`. */
export type ExprContext = Record<string, ExprValue>;

/**
 * `{{ … }}` is parsed by SCANNING, not by a regular expression.
 *
 * Two CodeQL `js/polynomial-redos` alerts (#2, #3) came out of the regex
 * version, and the second survived the obvious fix — which is the useful part.
 * Dropping the ambiguous `\s*` around the capture killed one witness
 * (`'{{{{' + ' '.repeat(n)`) and CodeQL immediately produced another
 * (`'{{{{a'` repeated). That is not a pattern bug: a GLOBAL lazy scan for a
 * delimiter that never arrives is quadratic by construction — O(n) starts, each
 * scanning O(n) forward — and no amount of tuning the pattern removes it.
 *
 * `indexOf` has no backtracking at all. Each character is visited a bounded
 * number of times, so this is linear by construction rather than by careful
 * pattern-writing, and there is no next witness to find.
 *
 * The behaviour is deliberately identical to the regexes it replaces, including
 * the odd corner: `{{a}}{{b}}` is a WHOLE expression whose path is `a}}{{b`
 * (which resolves to null), because the old pattern was `$`-anchored and its
 * lazy capture had to grow to reach the end. The PHP twin does the same, and
 * `shared/expr` is what holds the two together.
 */

/** The inner text of a template that is exactly one expression, else `null`. */
function wholeExpression(trimmed: string): string | null {
  if (trimmed.length < 4) return null;
  if (!trimmed.startsWith("{{") || !trimmed.endsWith("}}")) return null;
  return trimmed.slice(2, -2);
}

/**
 * Replace every `{{ … }}` run, left to right, in a single pass.
 *
 * An unterminated `{{` is literal text — the same thing the regex did by simply
 * not matching, and the case an author hits constantly while typing.
 */
function interpolate(template: string, resolve: (path: string) => string): string {
  let out = "";
  let i = 0;

  for (;;) {
    const open = template.indexOf("{{", i);
    if (open === -1) return out + template.slice(i);

    const close = template.indexOf("}}", open + 2);
    if (close === -1) return out + template.slice(i);

    out += template.slice(i, open) + resolve(template.slice(open + 2, close));
    i = close + 2;
  }
}

/**
 * Strings PHP's `Expr::truthy` treats as false.
 *
 * `"0"` and `"false"` are the ones that matter: a branch condition arriving as
 * text from a form or a JSON body would otherwise be truthy for every non-empty
 * string, and `"false"` taking the true branch is the kind of bug that looks
 * like the engine is broken.
 */
const FALSY_STRINGS = new Set(["", "0", "false", "no", "off", "null"]);

/**
 * What a resolution attempt ANSWERS — did the path resolve, and to what.
 *
 * `resolvePath` cannot express this, and that is the defect it exists to fix:
 * it returns `null` both for "this path does not exist" and for "this path
 * exists and holds null". One value standing for two states.
 *
 * At the interpolation layer the collapse is worse, because `null` stringifies
 * to `""`. A consumer put it exactly:
 *
 * > "An unresolvable path yields `''`, so a wrong field is indistinguishable
 * > from an empty one at runtime."
 *
 * A misspelled field renders as an empty string, which looks precisely like a
 * field that is legitimately empty. The graph runs, the node succeeds, and the
 * output is quietly missing a value nobody is told about — worst on
 * LLM-authored graphs, where the field name was guessed in the first place.
 *
 * Same shape as the four `??` collapses fixed across all four runtimes on
 * 2026-08-26 (absent vs null), one layer up: **presence is the only correct
 * test, and a return value that cannot express presence cannot be tested for
 * it.** Hence a second return channel rather than a cleverer sentinel — every
 * sentinel is a legal value for somebody.
 */
export interface Resolution {
  /** Whether the path resolved at all. `false` means it does not exist. */
  resolved: boolean;
  /** The value, when `resolved`. `null` when not — do not read it blind. */
  value: ExprValue;
}

/** Thrown by the `"throw"` policy when a path does not resolve. */
export class UnresolvedPathError extends Error {
  constructor(readonly path: string) {
    super(
      `Expression path "${path}" did not resolve. ` +
        `Under the "throw" policy an unresolvable path is an error rather than an empty string.`,
    );
    this.name = "UnresolvedPathError";
  }
}

/**
 * What evaluation does with a path that does not resolve.
 *
 * - `"empty"` — today's behaviour, and the DEFAULT. Interpolates to `""`; a
 *   whole expression yields `null`. Unchanged so that widening this API breaks
 *   nobody: 40 call sites across the runtimes assume it.
 * - `"keep"` — leave the `{{ … }}` text in place. The failure becomes VISIBLE
 *   in the output without stopping the run, which is what you want for
 *   human-reviewed content: a rendered `{{ in.recipient_naem }}` is self-
 *   diagnosing in a way an absence never is.
 * - `"throw"` — refuse. For hosts that would rather fail a run than deliver a
 *   silently incomplete result.
 *
 * Opt-in before default at the request of the consumer who reported it — the
 * host with the most LLM-authored graphs, and so both the biggest beneficiary
 * and the right place for it to break first if it is going to.
 */
export type UnresolvedPolicy = "empty" | "keep" | "throw";

/** Options for {@link evaluateExpression} / {@link evaluateConfig}. */
export interface EvaluateOptions {
  /** What to do with a path that does not resolve. Default `"empty"`. */
  onUnresolved?: UnresolvedPolicy;
}

/**
 * Resolve a dot-path, reporting WHETHER it resolved.
 *
 * The same walk as `resolvePath` — deliberately, so the two can never disagree
 * about what resolves; `resolvePath` is defined in terms of this one below.
 *
 * A note on JS having two absent values: a key present with the value
 * `undefined` reports `resolved: false`, matching `resolvePath`'s long-standing
 * behaviour. It cannot arise from graph data (JSON has no `undefined`), and
 * changing it would make the two functions disagree for no reachable gain.
 */
export function tryResolvePath(path: string, context: ExprContext): Resolution {
  const unresolved: Resolution = { resolved: false, value: null };

  const trimmed = path.trim();
  if (trimmed === "") return unresolved;

  const segments = trimmed.split(".");
  let cursor: ExprValue;

  const head = segments[0];
  if (head === "$json" || head === "$input") {
    cursor = context !== null && typeof context === "object" && "in" in context ? context.in : context;
    segments.shift();
  } else {
    cursor = context;
  }

  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return unresolved;
    if (typeof cursor !== "object") return unresolved;
    // Arrays are indexed by their numeric keys, matching PHP's list access.
    const next = (cursor as Record<string, ExprValue>)[segment];
    if (next === undefined) return unresolved;
    cursor = next;
  }

  return { resolved: true, value: cursor === undefined ? null : cursor };
}

/**
 * Resolve a dot-path against the context, honouring the `$json` / `$input`
 * alias.
 *
 * Both aliases point at the `in` port value when the context has one, and at
 * the whole context otherwise — the same fallback the PHP does, which is what
 * makes `{{ $json.x }}` work on a trigger node that has no upstream input.
 *
 * A path that does not resolve returns `null`, never `undefined`: PHP has one
 * absent value and JS has two, and letting the difference leak would make the
 * two runtimes disagree about `{{ missing }}` for no useful reason.
 */
export function resolvePath(path: string, context: ExprContext): ExprValue {
  // Defined in terms of `tryResolvePath` rather than repeating the walk. Two
  // copies of a traversal agree right up until someone edits one of them, and
  // nothing anywhere reports that -- the same reason the shared conformance
  // tables exist instead of hand-copied fixture rows.
  return tryResolvePath(path, context).value;
}

/**
 * Evaluate a template against a context.
 *
 * A string that is EXACTLY one expression returns the resolved value with its
 * type intact — `{{ $json.count }}` gives you a number, not `"3"`. Anything
 * else interpolates each run as text. That distinction is load-bearing: it is
 * what lets a config field carry either a value or a sentence.
 *
 * Non-string templates pass through untouched, so this is safe to map over a
 * whole config object.
 */
export function evaluateExpression(
  template: ExprValue,
  context: ExprContext,
  options: EvaluateOptions = {},
): ExprValue {
  if (typeof template !== "string") return template;

  const policy = options.onUnresolved ?? "empty";

  const whole = wholeExpression(template.trim());
  if (whole !== null) {
    const r = tryResolvePath(whole, context);
    if (r.resolved) return r.value;

    // The whole-expression branch returns `null` under `"empty"`, not `""` --
    // that is what it has always done, and the asymmetry is deliberate: this
    // branch preserves TYPE, so its absent value is the typed one.
    if (policy === "throw") throw new UnresolvedPathError(whole);
    return policy === "keep" ? template : null;
  }

  return interpolate(template, (path) => {
    const r = tryResolvePath(path, context);
    if (r.resolved) return stringify(r.value);
    if (policy === "throw") throw new UnresolvedPathError(path);
    return policy === "keep" ? `{{${path}}}` : "";
  });
}

/**
 * Truthiness for branch / switch decisions.
 *
 * Mirrors PHP's rules rather than JavaScript's, because the graph is authored
 * once and may run on either side. The two disagree in exactly the places a
 * workflow hits: `"0"` and `"false"` are truthy in JS and falsy here, and an
 * empty array is truthy in JS and falsy here.
 */
export function truthy(value: ExprValue): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return !FALSY_STRINGS.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

/** Coerce a value to text the way interpolation does. */
export function text(value: ExprValue): string {
  return stringify(value);
}

function stringify(value: ExprValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/**
 * Resolve every string in a config object, one level of nesting at a time.
 *
 * The convenience most hosts actually want, and the shape their hand-rolled
 * version usually takes. Opt-in like the rest of this module.
 */
export function evaluateConfig<T extends Record<string, ExprValue>>(
  config: T,
  context: ExprContext,
  options: EvaluateOptions = {},
): T {
  const out: Record<string, ExprValue> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = Array.isArray(value)
      ? value.map((v) => evaluateExpression(v, context, options))
      : value !== null && typeof value === "object"
        ? evaluateConfig(value as Record<string, ExprValue>, context, options)
        : evaluateExpression(value, context, options);
  }
  return out as T;
}
