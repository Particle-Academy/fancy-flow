/**
 * What a terminal has said, in a form a node can wait on.
 *
 * A raw `onData` stream is not something a workflow can match against, for
 * three reasons that all fail the same way — intermittently, and usually only
 * once there is real output moving:
 *
 *  1. **Chunks are arbitrary.** A PTY splits wherever it splits, so `Ready >`
 *     can arrive as `Rea` + `dy >`. Testing each chunk on its own finds the
 *     pattern when output is small enough to land in one write and misses it
 *     when it is not. So matching runs against an ACCUMULATED buffer, never a
 *     chunk.
 *
 *  2. **Output arrives before anyone is listening.** A node that types at a
 *     process and a node that waits for its reply are two steps, and anything
 *     printed between them is gone if the buffer starts when the wait does.
 *     So the transcript is attached when the SESSION opens, and a wait reads
 *     what has already accumulated before it subscribes to anything new.
 *
 *  3. **Escape sequences are everywhere and they also straddle.** An agent TUI
 *     writes `Ready` as `ESC[32m Ready ESC[0m`, so matching raw bytes fails on
 *     text a person can plainly read. Stripping per chunk reintroduces problem
 *     1 in a second guise — `ESC[3` + `2mReady` strips to `ESC[32mReady` with
 *     the escape now INSIDE the text. So an incomplete trailing sequence is
 *     held back until the rest of it arrives.
 *
 * Text is consumed through a match, so two waits for the same pattern do not
 * both resolve on the first occurrence — which would let a loop appear to make
 * progress while reading one old line forever.
 */

/**
 * The control characters, by code point rather than as literals.
 *
 * A raw ESC byte sitting in a `.ts` file survives most tools and not all of
 * them, and the failure is the quiet kind: strip one out and the pattern below
 * still parses, still looks right in review, and matches nothing — so every
 * wait fails on coloured output while the code reads as correct. It happened
 * twice while this file was being written, which is the argument.
 */
const ESC = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);
const BEL = String.fromCharCode(0x07);

/**
 * CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL|ST`), and the two-character
 * escapes. Written out rather than taken from a dependency: it is a regex, and
 * the suite's rule is that third-party code is a liability carried for years.
 */
const ANSI = new RegExp(
  `[${ESC}${CSI}](?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`,
  "g",
);

/**
 * How much unterminated escape to hold back before giving up on it.
 *
 * An OSC sequence carrying a window title is legitimately long, but a lone
 * `ESC` that never terminates is just a byte — holding the rest of the stream
 * hostage behind it would stall a wait forever, which is a worse failure than
 * one stray character in the output.
 */
const MAX_PENDING_ESCAPE = 1024;

/**
 * Cap on retained text. A chatty process across a long run would otherwise grow
 * this without limit. Dropping from the FRONT keeps the recent output — which
 * is what a wait is about to match — and a pattern spanning a megabyte of
 * output is not a pattern anybody wrote.
 */
const MAX_BUFFER = 1_000_000;

export type TranscriptWaitResult =
  | { status: "matched"; text: string; match: RegExpMatchArray }
  | { status: "timeout"; text: string }
  | { status: "exited"; text: string; exitCode: number; signal?: string };

export class TerminalTranscript {
  /** Stripped, complete text not yet consumed by a wait. */
  private text = "";

  /** Raw bytes held back because they may be the start of an escape sequence. */
  private tail = "";

  private readonly waiters = new Set<() => void>();

  /** Feed raw terminal output in. Safe to call with any chunking. */
  append(chunk: string): void {
    this.tail += chunk;

    const safe = this.safeLength();
    if (safe > 0) {
      this.text += this.tail.slice(0, safe).replace(ANSI, "");
      this.tail = this.tail.slice(safe);
    }

    if (this.text.length > MAX_BUFFER) {
      this.text = this.text.slice(this.text.length - MAX_BUFFER);
    }

    for (const wake of [...this.waiters]) wake();
  }

  /**
   * How much of `tail` can be stripped now.
   *
   * Everything, unless the final `ESC` has not yet been terminated — in which
   * case processing stops there and resumes when the rest arrives.
   */
  private safeLength(): number {
    const lastEsc = Math.max(this.tail.lastIndexOf(ESC), this.tail.lastIndexOf(CSI));
    if (lastEsc === -1) return this.tail.length;

    // A complete sequence starting there means nothing is pending.
    ANSI.lastIndex = lastEsc;
    const match = ANSI.exec(this.tail);
    ANSI.lastIndex = 0;
    if (match && match.index === lastEsc) return this.tail.length;

    // Unterminated, but long enough that it is not really an escape.
    if (this.tail.length - lastEsc > MAX_PENDING_ESCAPE) return this.tail.length;

    return lastEsc;
  }

  /** Unconsumed output, escape sequences removed. */
  peek(): string {
    return this.text;
  }

  /** Drop everything currently buffered — used before typing a new command. */
  clear(): void {
    this.text = "";
    this.tail = "";
  }

  /**
   * Wait until `pattern` matches the unconsumed text.
   *
   * Checks what has ALREADY arrived before subscribing, because the common case
   * is that the process answered while the previous node was still finishing.
   *
   * `exited` is raced deliberately. Without it, a shell that dies reports as
   * "timed out waiting for X" — sending whoever reads it to lengthen a timeout
   * for a process that is not running. Naming the exit is the difference
   * between a diagnosis and a wrong lead.
   */
  waitFor(
    pattern: RegExp,
    options: { timeoutMs: number; exited?: Promise<{ exitCode: number; signal?: string }> },
  ): Promise<TranscriptWaitResult> {
    return new Promise<TranscriptWaitResult>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: TranscriptWaitResult) => {
        if (settled) return;
        settled = true;
        this.waiters.delete(check);
        if (timer) clearTimeout(timer);
        resolve(result);
      };

      const check = () => {
        // A global or sticky pattern carries `lastIndex` between calls, so it
        // would start each attempt part-way through a buffer it has not read.
        pattern.lastIndex = 0;
        const match = pattern.exec(this.text);
        if (!match) return;

        // `|| 1` so a pattern that can match empty still makes progress rather
        // than consuming nothing and matching the same position forever.
        const through = match.index + (match[0].length || 1);
        const text = this.text.slice(0, through);
        this.text = this.text.slice(through);
        finish({ status: "matched", text, match });
      };

      this.waiters.add(check);
      check();
      if (settled) return;

      if (options.timeoutMs > 0) {
        timer = setTimeout(() => {
          const text = this.text;
          this.text = "";
          finish({ status: "timeout", text });
        }, options.timeoutMs);
        // Never hold a Node process open just to time out a wait nobody wants.
        (timer as unknown as { unref?: () => void }).unref?.();
      }

      options.exited?.then(
        (exit) => {
          // No re-check here, deliberately. `append` wakes every waiter the
          // instant data lands, so a process that prints its answer and then
          // exits has already matched by the time this runs — `settled` is
          // true and this returns. A re-check looked like it was guarding that
          // race and was in fact unreachable, which is worse than absent: it
          // read as a guarantee while the actual guarantee lived elsewhere.
          if (settled) return;
          const text = this.text;
          this.text = "";
          finish({ status: "exited", text, exitCode: exit.exitCode, signal: exit.signal });
        },
        () => {},
      );
    });
  }
}
