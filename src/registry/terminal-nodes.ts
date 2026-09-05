import type { NodeExecutor } from "../types";
import type { TranscriptWaitResult } from "../runtime/terminal-transcript";

/**
 * The three terminal primitives.
 *
 * They are core rather than marketplace for the same reason `subflow` is: they
 * introduce no third-party dependency. The PTY lives behind
 * `registerTerminalHost`, so this file imports nothing that a browser build
 * would choke on.
 *
 * ## Why three, and not one
 *
 * A terminal is two different things depending on what is running in it, and
 * one node cannot serve both:
 *
 *  - **A shell** answers a question and finishes, so the useful unit is
 *    "run this, tell me what it said and whether it worked" — `terminal_run`.
 *  - **A TUI** (Claude Code, Codex, a REPL, an installer asking a question)
 *    never finishes. There is no exit code to wait for and no prompt to return
 *    to; there is only text going in and text coming out. That is
 *    `terminal_send` + `terminal_await`, and it is the pair that makes an agent
 *    TUI drivable at all.
 *
 * Collapsing them into one node would mean guessing which mode the author
 * meant, and guessing wrong on a TUI means hanging until a timeout.
 */

const DEFAULT_TIMEOUT_MS = 120_000;

/** Enter, in a PTY, is a carriage return. */
const ENTER = "\r";

function configOf(node: unknown): Record<string, unknown> {
  return (((node as { data?: { config?: Record<string, unknown> } })?.data?.config) ?? {}) as Record<
    string,
    unknown
  >;
}

function text(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function millis(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(config[key]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * The marker `terminal_run` appends so it can tell when a command finished and
 * what it returned.
 *
 * A persistent shell has no completion channel — output just stops arriving,
 * and "stopped arriving" is indistinguishable from "still thinking". So the
 * command is followed by an echo of its own exit status, and THAT is what the
 * node waits for.
 *
 * The nonce matters: without it, a command whose own output happened to contain
 * the marker would end the wait early, and a run that left a stale marker in
 * the buffer would satisfy the NEXT command instantly. One per execution.
 */
export function exitMarker(nonce: string): { token: string; pattern: RegExp } {
  const token = `__fancy_flow_exit_${nonce}__`;
  return {
    token,
    // The expanded status is required to be digits. The shell ECHOES the typed
    // command back first, and that echo contains the marker with `$?`
    // unexpanded — so requiring digits is what stops the node matching its own
    // command line and reporting success before anything has run.
    pattern: new RegExp(`${token}:(\\d+)`),
  };
}

let counter = 0;

function newNonce(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Drop every line carrying the marker.
 *
 * Two of them exist in a normal run — the shell's echo of the command that was
 * typed, and the marker line itself — and neither is output the author asked
 * for. Filtering by line rather than slicing by index survives an echo that is
 * wrapped, disabled, or reordered, none of which is under our control.
 */
function withoutMarker(output: string, token: string): string {
  return output
    .split("\n")
    .filter((line) => !line.includes(token))
    .join("\n")
    .trim();
}

type Ctx = Parameters<NodeExecutor>[0];

/**
 * Abort, in a shape the compiler believes.
 *
 * `ctx.abort` is declared `=> never`, but TypeScript only narrows control flow
 * through a never-returning call when the callee is a plain function name — not
 * a mutable property on a parameter. So calling `ctx.abort` directly left every
 * later line thinking the run might have continued, and the code had to be
 * written as if a value could still be `undefined` after it had been rejected.
 *
 * That is not a cosmetic complaint: the workaround is a non-null assertion, and
 * a `!` on a line that "cannot be reached" is indistinguishable from a `!` on a
 * line that can.
 */
function fail(ctx: Ctx, message: string): never {
  ctx.abort(message);
  // Unreachable — `abort` throws. Present so this function's own return type is
  // honest without depending on the narrowing that is missing above.
  throw new Error(message);
}

/** Shared: resolve the lane's terminal, or abort naming the real problem. */
function requireTerminal(ctx: Ctx): NonNullable<Ctx["terminal"]> {
  if (!ctx.terminal) {
    fail(
      ctx,
      `"${String(ctx.node.data?.label ?? ctx.node.id)}" is a terminal node but is not inside a terminal lane. `
        + "Drag it into one — a terminal node outside a lane has no session to talk to, and opening a private "
        + "shell for it would defeat the point of the lane.",
    );
  }
  return ctx.terminal;
}

/**
 * The pattern a `terminal_await` waits for.
 *
 * Plain text is the default and is ESCAPED, so a prompt like `? (y/n)` matches
 * itself instead of being read as a regex and either failing to compile or —
 * worse — matching something else entirely while looking like it works.
 *
 * `g` and `y` are stripped from author-supplied flags. Both make a regex carry
 * `lastIndex` between calls, so the same pattern would resume part-way through
 * a buffer it had never read, and a wait would miss a match sitting in plain
 * view. The transcript resets `lastIndex` too; this is the belt to that
 * braces, because the cost of being wrong is a hang.
 */
function compilePattern(ctx: Ctx, raw: string, config: Record<string, unknown>): RegExp {
  const flags = typeof config.flags === "string" ? config.flags.replace(/[gy]/g, "") : "";
  try {
    return config.mode === "regex"
      ? new RegExp(raw, flags)
      : new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
  } catch (e) {
    // Named as an INVALID PATTERN. A bad regex thrown raw reads as a crash in
    // the engine rather than as a typo in one node's config.
    return fail(ctx, `terminal_await has an invalid regex: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * `terminal_run` — send a command, wait for it to finish, report its exit code.
 *
 * Shell-only, and it says so on the node: a TUI never returns to a prompt, so
 * there is nothing for the marker to ride on. Use send + await there.
 */
export const terminalRunExecutor: NodeExecutor = async (ctx) => {
  const config = configOf(ctx.node);
  const command = text(config, "command").trim();
  if (!command) fail(ctx, "terminal_run has no command configured");

  const terminal = requireTerminal(ctx);
  const session = await terminal.session();
  const transcript = await terminal.transcript();

  const { token, pattern } = exitMarker(newNonce());
  const timeoutMs = millis(config, "timeoutMs", DEFAULT_TIMEOUT_MS);

  // Everything the shell said before this command is somebody else's output.
  // Carrying it into this node's result would attribute the previous command's
  // text — and, worse, let a marker-shaped string from earlier satisfy the wait.
  transcript.clear();

  await session.write(`${command}; printf '${token}:%s\\n' "$?"${ENTER}`);

  const result = await transcript.waitFor(pattern, { timeoutMs, exited: session.exited });

  if (result.status === "exited") {
    fail(
      ctx,
      `The terminal exited (code ${result.exitCode}${result.signal ? `, signal ${result.signal}` : ""}) while `
        + `running "${command}". The lane's session is gone, so every later node in this lane would fail too.`,
    );
  }

  if (result.status === "timeout") {
    fail(
      ctx,
      `"${command}" did not finish within ${timeoutMs}ms. Raise the node's timeout if it is genuinely slow — `
        + "but a command that waits for input never finishes at all, and needs terminal_send + terminal_await.",
    );
  }

  const exitCode = Number(result.match[1]);
  const output = withoutMarker(result.text, token);

  const failOnNonZero = config.failOnNonZero !== false;
  if (failOnNonZero && exitCode !== 0) {
    // Aborting is the default because the alternative is the failure this whole
    // estate keeps finding: a step that failed, a run that reports success, and
    // nothing anywhere that says the two disagree.
    ctx.abort(`"${command}" exited ${exitCode}.\n${output}`);
  }

  return { output, exitCode, command };
};

/**
 * `terminal_send` — type at the process and move on.
 *
 * The node that makes a TUI usable. It does NOT wait, deliberately: what
 * counts as an answer is the author's decision, not ours, and pairing every
 * send with a hardcoded wait would make the common case (send, then await a
 * specific prompt) impossible to express.
 */
export const terminalSendExecutor: NodeExecutor = async (ctx) => {
  const config = configOf(ctx.node);
  const terminal = requireTerminal(ctx);
  const session = await terminal.session();

  const body = text(config, "text");
  // `submit !== false` — a send that does not press Enter leaves the text
  // sitting on the process's input line, which looks exactly like the process
  // ignoring it.
  const submit = config.submit !== false;

  if (config.clearFirst === true) {
    (await terminal.transcript()).clear();
  }

  await session.write(submit ? `${body}${ENTER}` : body);

  return { sent: body, submitted: submit };
};

/**
 * `terminal_await` — wait for the process to say something.
 *
 * The other half of driving a TUI. Without it a graph can type at Claude Code
 * and never learn that it has answered, so every downstream node runs against
 * whatever was on screen when the run started.
 *
 * Three ways it can end and all three are reported distinctly, because
 * collapsing them is how a wrong diagnosis gets shipped: a match, a timeout,
 * and the process EXITING — which without its own branch reads as "timed out",
 * sending whoever debugs it to lengthen a timeout on a process that is not
 * running.
 */
export const terminalAwaitExecutor: NodeExecutor = async (ctx) => {
  const config = configOf(ctx.node);
  const terminal = requireTerminal(ctx);
  const session = await terminal.session();
  const transcript = await terminal.transcript();

  const raw = text(config, "pattern").trim();
  if (!raw) fail(ctx, "terminal_await has no pattern configured — there is nothing for it to wait for");

  const pattern = compilePattern(ctx, raw, config);

  const timeoutMs = millis(config, "timeoutMs", DEFAULT_TIMEOUT_MS);
  const result: TranscriptWaitResult = await transcript.waitFor(pattern, {
    timeoutMs,
    exited: session.exited,
  });

  if (result.status === "exited") {
    fail(
      ctx,
      `The terminal exited (code ${result.exitCode}${result.signal ? `, signal ${result.signal}` : ""}) while `
        + `waiting for ${JSON.stringify(raw)}. It never appeared, and the lane's session is gone.`,
    );
  }

  if (result.status === "timeout") {
    // The default is to FAIL. An await that shrugs after a timeout lets the
    // next node type at a process that never became ready, and the run reports
    // success — so continuing has to be something the author asked for.
    if (config.onTimeout === "continue") {
      ctx.emit({
        type: "log",
        nodeId: ctx.node.id,
        level: "warn",
        message: `terminal_await: ${JSON.stringify(raw)} did not appear within ${timeoutMs}ms; continuing as configured.`,
      });
      return { matched: false, output: result.text, groups: [] };
    }

    fail(
      ctx,
      `${JSON.stringify(raw)} did not appear within ${timeoutMs}ms. Last output:\n${result.text.slice(-2000)}`,
    );
  }

  return {
    matched: true,
    output: result.text,
    matchedText: result.match[0],
    // Capture groups are the reason to use regex mode at all — a prompt that
    // reports a session id or a file path is only useful if the value comes out.
    groups: result.match.slice(1),
  };
};
