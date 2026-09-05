import { beforeEach, describe, expect, test } from "vitest";
import { registerTerminalHost, type TerminalHost, type TerminalSession } from "../src/registry/capabilities";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph, FlowNode } from "../src/types";

/**
 * `terminal_run`, `terminal_send`, `terminal_await` — end to end through a run.
 *
 * Driven against a fake that behaves like a real PTY in the two ways that break
 * naive code: it ECHOES what is typed at it (so a node can match its own
 * command and report success before anything ran), and it emits output in
 * pieces (so a matcher that tests one chunk at a time silently misses).
 *
 * A fake that answers in one clean chunk with no echo makes all of this pass
 * and proves none of it.
 */

const ESC = String.fromCharCode(0x1b);

type Fake = {
  host: TerminalHost;
  writes: string[];
  /** Emit output as the process would, in whatever pieces are asked for. */
  say: (...chunks: string[]) => void;
  exit: (exitCode: number) => void;
};

function fakeTerminal(options: { echo?: boolean; onWrite?: (data: string, fake: Fake) => void } = {}): Fake {
  const writes: string[] = [];
  let emit: (chunk: string) => void = () => {};
  let end: (v: { exitCode: number }) => void = () => {};

  const exited = new Promise<{ exitCode: number }>((resolve) => { end = resolve; });

  const fake: Fake = {
    writes,
    say: (...chunks) => { for (const c of chunks) emit(c); },
    exit: (exitCode) => end({ exitCode }),
    host: {
      open: () => {
        const session: TerminalSession = {
          id: "fake",
          write: (data) => {
            writes.push(data);
            // A real terminal echoes what was typed. That echo contains the
            // exit marker with `$?` UNEXPANDED, which is exactly what
            // `terminal_run`'s digit requirement has to survive.
            if (options.echo !== false) emit(data.replace(/\r$/, "\n"));
            options.onWrite?.(data, fake);
          },
          onData: (listener) => {
            emit = listener;
            return () => { emit = () => {}; };
          },
          exited,
          close: () => {},
        };
        return session;
      },
    },
  };

  return fake;
}

function node(id: string, type: string, config: Record<string, unknown>, parentId?: string): FlowNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id, config },
    ...(parentId ? { parentId } : {}),
  } as unknown as FlowNode;
}

/** A terminal lane wrapping the given nodes, wired in sequence. */
function laneGraph(nodes: FlowNode[]): FlowGraph {
  return {
    nodes: [
      node("lane", "@particle-academy/terminal_lane", { command: "bash" }),
      ...nodes,
    ],
    edges: nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: nodes[i].id, target: n.id })),
  } as unknown as FlowGraph;
}

/** The marker the run node wrote, read back out of what it typed. */
function markerIn(written: string): string | null {
  return written.match(/__fancy_flow_exit_[a-z0-9]+__/)?.[0] ?? null;
}

beforeEach(() => {
  registerBuiltinKinds();
});

describe("terminal_run", () => {
  test("returns the command's output and its exit code", async () => {
    const fake = fakeTerminal({
      onWrite: (data, f) => {
        const token = markerIn(data);
        if (token) f.say("3 passing\n", `${token}:0\n`);
      },
    });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([node("run", "terminal_run", { command: "npm test" }, "lane")]),
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.outputs.run).toMatchObject({ output: "3 passing", exitCode: 0 });

    restore();
  });

  test("does not mistake the shell's echo of its own command for the result", async () => {
    // The failure this guards is not subtle in effect and is invisible in
    // shape: the echoed line contains the marker, so a looser pattern matches
    // it the instant the command is typed. The node then reports success with
    // an empty output before the command has run at all — and every run looks
    // fast and green.
    const seen: string[] = [];
    const fake = fakeTerminal({
      onWrite: (data, f) => {
        const token = markerIn(data);
        if (!token) return;
        seen.push(data);
        // Deliberately slow, so a node that matched the echo would already have
        // finished by now.
        setTimeout(() => f.say("real output\n", `${token}:0\n`), 20);
      },
    });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([node("run", "terminal_run", { command: "sleep 1" }, "lane")]),
      {},
    );

    expect(result.ok).toBe(true);
    // The echo is genuinely present in the stream — otherwise this test would
    // be asserting against a hazard the fake never produced.
    expect(seen[0]).toContain('"$?"');
    expect(result.outputs.run).toMatchObject({ output: "real output", exitCode: 0 });

    restore();
  });

  test("fails the run on a non-zero exit by default", async () => {
    const fake = fakeTerminal({
      onWrite: (data, f) => {
        const token = markerIn(data);
        if (token) f.say("2 failing\n", `${token}:1\n`);
      },
    });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([node("run", "terminal_run", { command: "npm test" }, "lane")]),
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("exited 1");

    restore();
  });

  test("hands the exit code to the graph when asked to, instead of failing", async () => {
    const fake = fakeTerminal({
      onWrite: (data, f) => {
        const token = markerIn(data);
        if (token) f.say(`${token}:1\n`);
      },
    });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([node("run", "terminal_run", { command: "false", failOnNonZero: false }, "lane")]),
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.outputs.run).toMatchObject({ exitCode: 1 });

    restore();
  });

  test("names a timeout as a timeout, and says what to reach for instead", async () => {
    const fake = fakeTerminal({ onWrite: () => {} });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([node("run", "terminal_run", { command: "read x", timeoutMs: 30 }, "lane")]),
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not finish within 30ms");
    expect(result.error).toContain("terminal_send");

    restore();
  });

  test("reports a dead terminal as a dead terminal, not as a timeout", async () => {
    const fake = fakeTerminal({ onWrite: (_data, f) => f.exit(137) });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([node("run", "terminal_run", { command: "npm test", timeoutMs: 5000 }, "lane")]),
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("terminal exited");
    expect(result.error).toContain("137");
    expect(result.error).not.toContain("did not finish within");

    restore();
  });
});

describe("terminal_send", () => {
  test("presses Enter as a CARRIAGE RETURN", async () => {
    // `\n` works in plenty of shells and is wrong for a TUI: readline and Ink
    // both listen for `\r`. Sending the wrong one looks exactly like the
    // process ignoring the prompt, which sends someone to debug the agent.
    const fake = fakeTerminal();
    const restore = registerTerminalHost(fake.host);

    await runFlow(laneGraph([node("send", "terminal_send", { text: "hello" }, "lane")]), {});

    expect(fake.writes).toEqual(["hello\r"]);

    restore();
  });

  test("leaves the line unsubmitted when asked", async () => {
    const fake = fakeTerminal();
    const restore = registerTerminalHost(fake.host);

    await runFlow(
      laneGraph([node("send", "terminal_send", { text: "partial", submit: false }, "lane")]),
      {},
    );

    expect(fake.writes).toEqual(["partial"]);

    restore();
  });
});

describe("terminal_await", () => {
  test("matches a prompt that arrives in pieces, after a send", async () => {
    // The whole point of the feature: prompt an agent TUI and know when it has
    // answered. The reply is emitted in three chunks with colour in the middle,
    // which is what a TUI actually does.
    const fake = fakeTerminal({
      echo: false,
      onWrite: (data, f) => {
        if (!data.startsWith("Summarise")) return;
        setTimeout(() => f.say("think", "ing", `...\n${ESC}[32mDone${ESC}[0m\n> `), 5);
      },
    });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([
        node("send", "terminal_send", { text: "Summarise the failure" }, "lane"),
        node("wait", "terminal_await", { pattern: "Done", timeoutMs: 2000 }, "lane"),
      ]),
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.outputs.wait).toMatchObject({ matched: true, matchedText: "Done" });

    restore();
  });

  test("treats plain-text mode as literal, not as a regex", async () => {
    // A prompt like `? (y/n)` is full of regex metacharacters. Read as a
    // pattern it either fails to compile or matches something else — and the
    // second one is the dangerous half, because the run continues.
    const fake = fakeTerminal({ echo: false });
    const restore = registerTerminalHost(fake.host);

    const run = runFlow(
      laneGraph([node("wait", "terminal_await", { pattern: "Continue? (y/n)", timeoutMs: 2000 }, "lane")]),
      {},
    );

    setTimeout(() => fake.say("Continue? (y/n) "), 5);

    const result = await run;
    expect(result.ok).toBe(true);
    expect(result.outputs.wait).toMatchObject({ matched: true });

    restore();
  });

  test("returns capture groups in regex mode", async () => {
    const fake = fakeTerminal({ echo: false });
    const restore = registerTerminalHost(fake.host);

    const run = runFlow(
      laneGraph([
        node("wait", "terminal_await", {
          pattern: "session ([a-z0-9]+) ready",
          mode: "regex",
          timeoutMs: 2000,
        }, "lane"),
      ]),
      {},
    );

    setTimeout(() => fake.say("session ab12 ready\n"), 5);

    const result = await run;
    expect(result.outputs.wait).toMatchObject({ matched: true, groups: ["ab12"] });

    restore();
  });

  test("FAILS the run by default when the pattern never appears", async () => {
    // The default has to be failure. Shrugging lets the next node type at a
    // process that never became ready, and the run reports success — the exact
    // shape where a broken workflow looks like a working one.
    const fake = fakeTerminal({ echo: false });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([node("wait", "terminal_await", { pattern: "never", timeoutMs: 30 }, "lane")]),
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("did not appear within 30ms");

    restore();
  });

  test("continues with matched:false only when the author asked it to", async () => {
    const fake = fakeTerminal({ echo: false });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([
        node("wait", "terminal_await", { pattern: "never", timeoutMs: 30, onTimeout: "continue" }, "lane"),
      ]),
      {},
    );

    expect(result.ok).toBe(true);
    expect(result.outputs.wait).toMatchObject({ matched: false });

    restore();
  });

  test("names an invalid regex as a config problem, not an engine crash", async () => {
    const fake = fakeTerminal({ echo: false });
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      laneGraph([node("wait", "terminal_await", { pattern: "([unclosed", mode: "regex" }, "lane")]),
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid regex");

    restore();
  });
});

describe("terminal nodes outside a lane", () => {
  test("say which lane they are missing rather than opening a shell of their own", async () => {
    const fake = fakeTerminal();
    const restore = registerTerminalHost(fake.host);

    const result = await runFlow(
      {
        nodes: [node("send", "terminal_send", { text: "hi" })],
        edges: [],
      } as unknown as FlowGraph,
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not inside a terminal lane");
    // Nothing was spawned. A node that quietly opened its own shell would be
    // one unmanaged process per node, which is what the lane exists to prevent.
    expect(fake.writes).toEqual([]);

    restore();
  });
});

describe("a lane's nodes share one terminal", () => {
  test("run, send and await all talk to the same session", async () => {
    let opens = 0;
    const fake = fakeTerminal({
      onWrite: (data, f) => {
        const token = markerIn(data);
        if (token) f.say(`ok\n${token}:0\n`);
      },
    });
    const counted: TerminalHost = {
      open: (spec) => { opens += 1; return fake.host.open(spec); },
    };
    const restore = registerTerminalHost(counted);

    const result = await runFlow(
      laneGraph([
        node("run", "terminal_run", { command: "cd /srv" }, "lane"),
        node("send", "terminal_send", { text: "hello" }, "lane"),
        node("wait", "terminal_await", { pattern: "hello", timeoutMs: 2000 }, "lane"),
      ]),
      {},
    );

    expect(result.ok).toBe(true);
    // One session for three nodes. Two would still look correct at every
    // individual node — it is the shared state between them (`cd`, an agent's
    // conversation) that silently stops existing.
    expect(opens).toBe(1);

    restore();
  });
});
