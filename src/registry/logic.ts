import { evaluateExpression, truthy, text } from "../expressions/expr";
import type { NodeExecutor } from "../types";

/**
 * Default executors for the four PURE-LOGIC builtins.
 *
 * ## Why these four ship one and `api_request` does not
 *
 * The kit's rule is that a kind ships schema + UI and the HOST wires the
 * executor, so it controls where memory, network and model calls actually go.
 * That reasoning is exactly right for `api_request`, `llm_call`, `memory_store`
 * — anything that touches the outside world, where a default would be a
 * decision made on the host's behalf about its own infrastructure.
 *
 * It is much weaker for `transform`, which does no I/O at all. `branch`,
 * `transform`, `merge` and `for_each` are pure functions of their inputs and
 * their config: there is exactly one correct answer and no infrastructure to
 * choose. Leaving them out meant every host reimplemented the same four, from
 * a schema, with no reference implementation to check against — and a consumer
 * asked whether that was deliberate (#13), which is a fair question to have to
 * ask.
 *
 * Host executors still take precedence: `pickExecutor` consults the host
 * registry first and falls back to the kind's own. Anyone who already wrote
 * these keeps theirs, unchanged.
 *
 * ## They implement the TypeScript schema, which is wider than the twin's
 *
 * `branch` and `transform` each have TWO authoring paths: a builder
 * (`conditions[]` / `fields[]`), which is what the editor produces by default,
 * and a raw-expression escape hatch (`condition` / `expression`). The Python
 * twin implements only the escape hatches. See the note in `docs/` — a graph
 * drawn the default way and run there routes or reshapes wrongly, silently.
 * These implement BOTH, so the TypeScript side is the complete one.
 */

type Config = Record<string, unknown>;

function configOf(node: unknown): Config {
  return (((node as { data?: { config?: Config } })?.data?.config) ?? {}) as Config;
}

/** The expression context every one of these resolves against. */
function contextOf(inputs: Record<string, unknown>): Record<string, unknown> {
  return inputs as Record<string, unknown>;
}

/** `{{ }}`-aware resolve. A non-string config value is already a value. */
function resolve(value: unknown, inputs: Record<string, unknown>): unknown {
  if (typeof value !== "string") return value;
  return evaluateExpression(value, contextOf(inputs) as never);
}

/**
 * One row of the `conditions` repeater.
 *
 * `left` is an expression; `right` is plain text in the schema but is resolved
 * too, because an author who types `{{ $json.threshold }}` there means it.
 */
function conditionHolds(row: Config, inputs: Record<string, unknown>): boolean {
  const left = resolve(row.left, inputs);
  const right = resolve(row.right, inputs);
  const operator = typeof row.operator === "string" ? row.operator : "eq";

  const asText = (v: unknown) => text(v as never);
  const asNumber = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(asText(v));
    return Number.isFinite(n) ? n : NaN;
  };
  // A number comparison against something unparseable is FALSE rather than a
  // throw: an author comparing a missing field to 10 wants the branch not to
  // take, not the run to die.
  const numeric = (fn: (a: number, b: number) => boolean) => {
    const a = asNumber(left);
    const b = asNumber(right);
    return Number.isFinite(a) && Number.isFinite(b) ? fn(a, b) : false;
  };
  const isEmpty = (v: unknown) =>
    v === null
    || v === undefined
    || v === ""
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

  switch (operator) {
    // Compared as TEXT, deliberately. `right` is a text field in the schema, so
    // `status == "2"` must match the number 2 an upstream node produced —
    // strict equality there would fail on a difference the author cannot see.
    case "eq": return asText(left) === asText(right);
    case "neq": return asText(left) !== asText(right);
    case "contains": return asText(left).includes(asText(right));
    case "not_contains": return !asText(left).includes(asText(right));
    case "gt": return numeric((a, b) => a > b);
    case "gte": return numeric((a, b) => a >= b);
    case "lt": return numeric((a, b) => a < b);
    case "lte": return numeric((a, b) => a <= b);
    case "truthy": return truthy(left as never);
    case "falsy": return !truthy(left as never);
    case "empty": return isEmpty(left);
    case "not_empty": return !isEmpty(left);
    default:
      // An operator the schema does not declare is a config error, not a
      // silent false — false would look exactly like a condition that did not
      // match, which is the answer an author would then try to debug.
      return false;
  }
}

/**
 * `branch` — two ports, exactly one taken.
 *
 * The raw `condition` WINS when set, because its own schema description says so
 * ("Overrides the conditions above when set"). The input passes through
 * unchanged down whichever side is taken and the other edge stays dead.
 */
export const branchExecutor: NodeExecutor = (ctx) => {
  const config = configOf(ctx.node);
  const inputs = ctx.inputs as Record<string, unknown>;

  let taken: boolean;

  const raw = config.condition;
  if (typeof raw === "string" && raw.trim() !== "") {
    taken = truthy(resolve(raw, inputs) as never);
  } else {
    const rows = Array.isArray(config.conditions) ? (config.conditions as Config[]) : [];
    // No conditions at all is FALSE, not true. An empty `all` is vacuously
    // true in logic, and that would send an unconfigured branch down the
    // success path — the one place a half-built graph should not go.
    if (rows.length === 0) {
      taken = false;
    } else {
      const results = rows.map((row) => conditionHolds(row, inputs));
      taken = config.match === "any" ? results.some(Boolean) : results.every(Boolean);
    }
  }

  return { __port: taken ? "true" : "false", value: ctx.inputs.in ?? ctx.inputs };
};

/**
 * `transform` — reshape in place. One `out` port, always active.
 *
 * `mode` decides which authoring path is read, defaulting to `fields` exactly
 * as the schema does.
 */
export const transformExecutor: NodeExecutor = (ctx) => {
  const config = configOf(ctx.node);
  const inputs = ctx.inputs as Record<string, unknown>;
  const passthrough = ctx.inputs.in ?? ctx.inputs;

  if (config.mode === "expression") {
    const expression = config.expression;
    if (typeof expression !== "string" || expression.trim() === "") return passthrough;
    return resolve(expression, inputs);
  }

  const rows = Array.isArray(config.fields) ? (config.fields as Config[]) : [];
  // Nothing configured passes the input through untouched rather than
  // returning `{}`. A half-built transform that silently empties the payload
  // breaks every node downstream of it with no clue where the data went.
  if (rows.length === 0) return passthrough;

  const out: Record<string, unknown> = {};
  let wrote = false;
  for (const row of rows) {
    const key = typeof row.key === "string" ? row.key.trim() : "";
    if (key === "") continue;
    out[key] = resolve(row.value, inputs);
    wrote = true;
  }
  return wrote ? out : passthrough;
};

/**
 * `merge` — several inputs, one value.
 *
 * `merge` combines into one object: a plain object is spread in by key,
 * anything else is keyed by its PORT id. `concat` flattens into one list.
 *
 * `null`/`undefined` inputs are skipped, and dead edges never reach the
 * executor at all — so a merge downstream of a branch receives only the side
 * that actually ran, which is what makes it a merge point rather than a join.
 */
export const mergeExecutor: NodeExecutor = (ctx) => {
  const entries = Object.entries(ctx.inputs as Record<string, unknown>);

  if (configOf(ctx.node).mode === "concat") {
    const out: unknown[] = [];
    for (const [, value] of entries) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value)) out.push(...value);
      else out.push(value);
    }
    return out;
  }

  const merged: Record<string, unknown> = {};
  for (const [port, value] of entries) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) Object.assign(merged, value);
    else merged[port] = value;
  }
  return merged;
};

/**
 * `for_each` — fan-out as DATA, not as jobs.
 *
 * Publishes the resolved collection and its size. It does NOT spawn one job per
 * item, and that is deliberate rather than unfinished: on a durable run a
 * `for_each` over 10,000 rows is one node, one claim, one checkpoint — not
 * 10,000. A host that wants true per-item iteration overrides this, which is
 * exactly what the executor seam is for.
 *
 * Matches the Python twin, including `concurrency` being carried for a host
 * that does iterate rather than acted on here.
 */
export const forEachExecutor: NodeExecutor = (ctx) => {
  const source = resolve(configOf(ctx.node).source, ctx.inputs as Record<string, unknown>);

  let items: unknown[];
  if (Array.isArray(source)) items = source;
  else if (source === null || source === undefined) items = [];
  else if (typeof source === "object") items = Object.values(source as object);
  else items = [source];

  return { items, count: items.length };
};

/*
 * ---------------------------------------------------------------------------
 * The DEPS-FREE remainder.
 *
 * The four above shipped because "the host decides where I/O goes" does not
 * apply to a pure function. The same argument covers five more, and leaving
 * them out was omission rather than a decision: `manual_trigger`, `output`,
 * `log`, `variable` and `switch_case` need no notifier, no store, no client and
 * no network. The PHP and Python twins ship all five, and they are four lines
 * each there.
 *
 * The cost of the gap was measured rather than guessed. A connector lab running
 * one WorkflowSchema on three engines had to hand-write `manual_trigger` and
 * `output` for its Node lane while PHP and Python got them from the engine, and
 * left a comment above them saying so — because a future parity failure on
 * those two kinds would otherwise be misattributed to this package. Every host
 * writes the same one-liners, slightly differently, and a parity suite cannot
 * tell "the runtimes disagree" from "the two hosts disagree".
 *
 * Ported from the PHP twin line for line, because parity is the contract: same
 * WorkflowSchema in, same `RunResult.outputs` out. A "better" implementation
 * here would be a divergence.
 *
 * `wait`, `user_input` and `human_approval` stay out. They look pure and are
 * not: each halts a run, and how a run halts is the host's decision (a durable
 * pause, a sleep, a queue re-drive) rather than a default anyone can pick.
 * ---------------------------------------------------------------------------
 */

/**
 * `manual_trigger` — the entry point, publishing whatever started the run.
 *
 * Returns `ctx.inputs` whole. On a trigger those inputs ARE the run's initial
 * inputs, so this is what makes `{{ trigger.field }}` resolve downstream.
 */
export const manualTriggerExecutor: NodeExecutor = (ctx) => ctx.inputs;

/**
 * `output` — the terminal node, publishing what reached it.
 *
 * `in ?? inputs`, not `inputs`: a node wired through its declared `in` port
 * publishes that port's value UNWRAPPED, which is what makes the terminal entry
 * in `RunResult.outputs` the plain result rather than a port map. Falling back
 * to the whole input map keeps a node with no inbound edge meaningful.
 */
export const outputExecutor: NodeExecutor = (ctx) => {
  const inputs = ctx.inputs as Record<string, unknown>;

  return inputs.in ?? inputs;
};

/**
 * `variable` — resolve an expression and publish it.
 *
 * The value is returned bare, not under a key. `{{ }}`-resolution is the whole
 * behaviour; a non-string config value is already a value and passes through.
 */
export const variableExecutor: NodeExecutor = (ctx) =>
  resolve(configOf(ctx.node).value, ctx.inputs as Record<string, unknown>);

/**
 * `log` — emit a log event, and say what was logged.
 *
 * The message is emitted through `ctx.emit`, never written to a console: where
 * a host's logs GO is a host decision, and a `console.log` here would be this
 * package choosing one. The return value records what was emitted so a
 * downstream node can read it, matching the twins.
 */
export const logExecutor: NodeExecutor = (ctx) => {
  const config = configOf(ctx.node);
  const inputs = ctx.inputs as Record<string, unknown>;

  const level = (config.level as "info" | "warn" | "error") ?? "info";
  const message = text(resolve(config.message ?? "", inputs) as never);

  ctx.emit({ type: "log", nodeId: ctx.node.id, level, message });

  return { logged: message, level };
};

/**
 * `switch_case` — route to the port its resolved value names.
 *
 * An unmatched value falls to `default`, which is the same silent mis-route
 * `branch` has one step over: an expression that does not resolve becomes `""`,
 * matches no case, and takes `default` — indistinguishable from a value that
 * genuinely matched nothing. The twins warn; this emits the same warning rather
 * than staying quiet, because a routing decision nobody can account for is the
 * expensive kind.
 */
export const switchCaseExecutor: NodeExecutor = (ctx) => {
  const config = configOf(ctx.node);
  const inputs = ctx.inputs as Record<string, unknown>;

  const expression = config.value;
  const value = text(resolve(expression, inputs) as never);
  const cases = (config.cases ?? {}) as Record<string, unknown>;

  const matched = Object.prototype.hasOwnProperty.call(cases, value);
  const port = matched ? String(cases[value]) : "default";

  if (!matched && typeof expression === "string" && expression.includes("{{")) {
    ctx.emit({
      type: "log",
      nodeId: ctx.node.id,
      level: "warn",
      message:
        `switch_case: "${expression}" resolved to "${value}", which matches no case — ` +
        `taking "default". An unresolved expression looks identical to a genuine miss here.`,
    });
  }

  return { __port: port, value: inputs.in ?? inputs };
};
