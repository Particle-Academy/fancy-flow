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
 * Matches a whole-string single expression: `{{ … }}` and nothing else.
 *
 * **No `\s*` around the capture, deliberately.** It used to read
 * `^\{\{\s*([\s\S]*?)\s*\}\}$`, and those two `\s*` are ambiguous with the lazy
 * capture between them: given a string that opens `{{` and never closes, the
 * engine tries every split between "whitespace the `\s*` ate" and "whitespace
 * the capture ate" — quadratic in the run length, and in practice a hang.
 * (CodeQL js/polynomial-redos, alerts #2 and #3.)
 *
 * Nothing is lost by dropping it: `resolvePath` trims its argument and always
 * did, so the padding was being removed twice.
 *
 * The PHP twin keeps its `\s*` and that is CORRECT, not drift. PCRE
 * auto-possessifies and anchors this pattern, so the same input returns in 0ms
 * there — measured, not assumed. The flaw is specific to the JavaScript engine.
 * Both sides still trim in `resolvePath`, so the resolved path is identical and
 * `shared/expr` passes on both; do not "fix" the PHP one for symmetry.
 */
const WHOLE = /^\{\{([\s\S]*?)\}\}$/;
/** Every `{{ … }}` run, for interpolation. Same no-`\s*` rule as {@link WHOLE}. */
const EACH = /\{\{([\s\S]*?)\}\}/g;

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
  const trimmed = path.trim();
  if (trimmed === "") return null;

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
    if (cursor === null || cursor === undefined) return null;
    if (typeof cursor !== "object") return null;
    // Arrays are indexed by their numeric keys, matching PHP's list access.
    const next = (cursor as Record<string, ExprValue>)[segment];
    if (next === undefined) return null;
    cursor = next;
  }

  return cursor === undefined ? null : cursor;
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
export function evaluateExpression(template: ExprValue, context: ExprContext): ExprValue {
  if (typeof template !== "string") return template;

  const whole = WHOLE.exec(template.trim());
  if (whole) return resolvePath(whole[1] ?? "", context);

  return template.replace(EACH, (_m, path: string) => stringify(resolvePath(path, context)));
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
export function evaluateConfig<T extends Record<string, ExprValue>>(config: T, context: ExprContext): T {
  const out: Record<string, ExprValue> = {};
  for (const [key, value] of Object.entries(config)) {
    out[key] = Array.isArray(value)
      ? value.map((v) => evaluateExpression(v, context))
      : value !== null && typeof value === "object"
        ? evaluateConfig(value as Record<string, ExprValue>, context)
        : evaluateExpression(value, context);
  }
  return out as T;
}
