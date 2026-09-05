import { describe, expect, test } from "vitest";
import { TerminalTranscript } from "../src/runtime/terminal-transcript";

/**
 * The matching engine behind `terminal_await`.
 *
 * Every test here is for a failure that is INTERMITTENT in production and
 * green in a naive test: small outputs arrive in one chunk, so per-chunk
 * matching works until it doesn't; a fake host emits plain text, so a missing
 * ANSI strip is invisible until a real TUI prints in colour; a fast fake
 * answers before the wait starts only sometimes.
 *
 * So each one reproduces the awkward case deliberately rather than the happy
 * one — a test that feeds a whole line in a single chunk asserts nothing about
 * the thing that actually breaks.
 */

const ESC = String.fromCharCode(0x1b);

function feed(t: TerminalTranscript, ...chunks: string[]): void {
  for (const chunk of chunks) t.append(chunk);
}

describe("TerminalTranscript", () => {
  test("matches a pattern split across chunk boundaries", async () => {
    // THE test. A PTY splits wherever it splits, and "Ready" arriving as
    // "Rea" + "dy" is normal rather than exotic. Matching per chunk finds this
    // pattern never, and finds it every time in a test that writes it whole.
    const t = new TerminalTranscript();
    const waiting = t.waitFor(/Ready/, { timeoutMs: 1000 });

    feed(t, "Rea", "dy > ");

    await expect(waiting).resolves.toMatchObject({ status: "matched" });
  });

  test("matches a word a TUI has coloured PART of", async () => {
    // Escapes *around* the word prove nothing — `/Ready/` matches inside
    // `ESC[32mReady ESC[0m` whether or not anything was stripped, so a test
    // written that way passes with the strip deleted. It was, and it did.
    //
    // The case that needs stripping is an escape INSIDE the match, which is
    // ordinary for a TUI that highlights a prefix or repositions mid-word.
    const t = new TerminalTranscript();
    const waiting = t.waitFor(/Ready/, { timeoutMs: 1000 });

    feed(t, `${ESC}[1mRea${ESC}[0m${ESC}[32mdy${ESC}[0m`);

    await expect(waiting).resolves.toMatchObject({ status: "matched" });
  });

  test("holds back an escape sequence that itself straddles chunks", async () => {
    // The second guise of the chunk problem, and the one a per-chunk strip
    // creates rather than solves: `ESC[3` + `2mReady` stripped separately
    // leaves `ESC[32mReady` — the escape now INSIDE the text, so the pattern
    // fails on output that renders as plain "Ready".
    const t = new TerminalTranscript();

    feed(t, `${ESC}[3`, "2mReady");

    expect(t.peek()).toBe("Ready");
  });

  test("gives a wait output that arrived before it started", async () => {
    // A node that types and a node that reads are two steps. Anything the
    // process said in between is unrecoverable if the buffer starts when the
    // WAIT does — so a fast process is missed and a slow one caught, which
    // presents as flakiness rather than as a bug.
    const t = new TerminalTranscript();

    feed(t, "already here\n");

    await expect(t.waitFor(/already/, { timeoutMs: 1000 })).resolves.toMatchObject({
      status: "matched",
    });
  });

  test("consumes through the match, so the same pattern does not resolve twice on one line", async () => {
    // Without this a loop reads one old line forever and reports progress on
    // every pass.
    const t = new TerminalTranscript();
    feed(t, "prompt> ");

    await expect(t.waitFor(/prompt> /, { timeoutMs: 1000 })).resolves.toMatchObject({
      status: "matched",
    });

    const second = t.waitFor(/prompt> /, { timeoutMs: 30 });
    await expect(second).resolves.toMatchObject({ status: "timeout" });
  });

  test("returns the text UP TO the match, not the whole buffer", async () => {
    const t = new TerminalTranscript();
    feed(t, "line one\nline two\nDONE\ntrailing");

    const result = await t.waitFor(/DONE/, { timeoutMs: 1000 });

    expect(result.text).toBe("line one\nline two\nDONE");
    expect(t.peek()).toBe("\ntrailing");
  });

  test("reports a timeout with what it did see", async () => {
    const t = new TerminalTranscript();
    feed(t, "nothing useful");

    const result = await t.waitFor(/never/, { timeoutMs: 30 });

    expect(result.status).toBe("timeout");
    expect(result.text).toBe("nothing useful");
  });

  test("reports the process EXITING as its own outcome, not as a timeout", async () => {
    // The wrong-diagnosis case. A dead shell reported as "timed out waiting for
    // X" sends whoever reads it to lengthen a timeout on a process that is not
    // running — true of the symptom, useless about the cause.
    const t = new TerminalTranscript();
    let end: (v: { exitCode: number }) => void = () => {};
    const exited = new Promise<{ exitCode: number }>((resolve) => { end = resolve; });

    const waiting = t.waitFor(/never/, { timeoutMs: 5000, exited });
    end({ exitCode: 137 });

    await expect(waiting).resolves.toMatchObject({ status: "exited", exitCode: 137 });
  });

  test("a match that arrived before the exit wins the race", async () => {
    // A process that prints its answer and immediately exits is ordinary. If
    // the exit won that race the run would fail on output it had already been
    // given, and the failure would depend on scheduling.
    //
    // The property is delivered by `append` waking waiters synchronously, so
    // the match settles before the exit's `.then` is ever reached. Worth
    // stating as a test even though no single line implements it: the two
    // mechanisms are in different methods, and nothing else would notice if
    // one of them stopped being synchronous.
    const t = new TerminalTranscript();
    let end: (v: { exitCode: number }) => void = () => {};
    const exited = new Promise<{ exitCode: number }>((resolve) => { end = resolve; });

    const waiting = t.waitFor(/all done/, { timeoutMs: 5000, exited });
    feed(t, "all done\n");
    end({ exitCode: 0 });

    await expect(waiting).resolves.toMatchObject({ status: "matched" });
  });

  test("a global pattern does not skip past the buffer it has not read", async () => {
    // `/g` carries `lastIndex` between calls, so a re-check would resume
    // part-way through and miss a match sitting in plain view.
    const t = new TerminalTranscript();
    const pattern = /ready/g;
    pattern.lastIndex = 999;

    const waiting = t.waitFor(pattern, { timeoutMs: 1000 });
    feed(t, "ready");

    await expect(waiting).resolves.toMatchObject({ status: "matched" });
  });

  test("clear() drops output the next wait must not match", async () => {
    const t = new TerminalTranscript();
    feed(t, "stale prompt> ");

    t.clear();

    await expect(t.waitFor(/stale/, { timeoutMs: 30 })).resolves.toMatchObject({
      status: "timeout",
    });
  });

  test("gives up on an ESC that never terminates rather than stalling forever", async () => {
    // A lone ESC byte would otherwise hold the entire stream behind it, and a
    // wait would hang on output that had already arrived — a worse failure than
    // one stray character in the text.
    const t = new TerminalTranscript();

    feed(t, ESC + "x".repeat(2000));

    expect(t.peek().length).toBeGreaterThan(1000);
  });
});
