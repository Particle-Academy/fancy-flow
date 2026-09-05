import { beforeEach, describe, expect, test } from "vitest";
import { createFancyTermHost, type PtyBackendLike } from "../src/terminal/fancy-term-host";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { registerTerminalHost } from "../src/registry/capabilities";
import { runFlow } from "../src/runtime/run-flow";
import type { FlowGraph, FlowNode } from "../src/types";

/**
 * The `fancy-term-host` adapter.
 *
 * Tested against a fake implementing `PtyBackendLike` rather than a real PTY,
 * because `node-pty` is a native peer this package deliberately does not carry
 * — see the adapter's own docblock for why the backend is an argument.
 *
 * The fake is written to `fancy-term-host@0.5.0`'s `PtyBackend` (`src/backend.ts`):
 * id-keyed `create`/`write`/`kill`, and `on('data' | 'exit')` fanning EVERY
 * terminal's output through one callback. That last detail is the one worth
 * reproducing faithfully — an adapter that forgot to filter by id would give
 * every lane every other lane's output, and with a single terminal open it
 * would look perfect.
 */

type Spawned = { id: string; opts: Record<string, unknown>; killed: boolean };

function fakeBackend() {
  const spawned: Spawned[] = [];
  const dataListeners: Array<(id: string, chunk: string) => void> = [];
  const exitListeners: Array<(id: string, p: { exitCode: number; signal?: number }) => void> = [];
  const writes: Array<{ id: string; data: string }> = [];

  const backend: PtyBackendLike = {
    create: (opts) => {
      spawned.push({ id: opts.id, opts: opts as unknown as Record<string, unknown>, killed: false });
      return { id: opts.id, pid: 1000 + spawned.length, shell: opts.shell ?? "/bin/sh" };
    },
    write: (id, data) => { writes.push({ id, data }); return true; },
    kill: (id) => {
      const found = spawned.find((s) => s.id === id);
      if (found) found.killed = true;
      return true;
    },
    on: (event: string, listener: unknown) => {
      if (event === "data") dataListeners.push(listener as (id: string, chunk: string) => void);
      if (event === "exit") exitListeners.push(listener as (id: string, p: { exitCode: number; signal?: number }) => void);
      return backend;
    },
  } as PtyBackendLike;

  return {
    backend,
    spawned,
    writes,
    subscriptions: () => dataListeners.length + exitListeners.length,
    say: (id: string, chunk: string) => { for (const l of [...dataListeners]) l(id, chunk); },
    exit: (id: string, exitCode: number, signal?: number) => {
      for (const l of [...exitListeners]) l(id, { exitCode, signal });
    },
  };
}

let ids = 0;
const predictableIds = () => { ids += 1; return `t${ids}`; };

beforeEach(() => {
  ids = 0;
  registerBuiltinKinds();
});

describe("createFancyTermHost", () => {
  test("spawns with the lane's command, cwd and env", () => {
    const fake = fakeBackend();
    const host = createFancyTermHost(fake.backend, { newId: predictableIds, cwd: "/fallback" });

    host.open({ command: "bash", cwd: "/srv/app", env: { CI: "1" }, cols: 120, rows: 40 });

    expect(fake.spawned[0].opts).toMatchObject({
      id: "t1",
      shell: "bash",
      cwd: "/srv/app",
      cols: 120,
      rows: 40,
    });
    expect(fake.spawned[0].opts.env).toMatchObject({ CI: "1" });
  });

  test("a lane's env overrides a default rather than the other way round", () => {
    // A default exists to fill a gap. Letting it win would mean a value typed
    // on the node silently did nothing, which is the worst kind of config bug:
    // visible in the editor, absent at runtime.
    const fake = fakeBackend();
    const host = createFancyTermHost(fake.backend, {
      newId: predictableIds,
      env: { TERM: "dumb", KEEP: "yes" },
    });

    host.open({ env: { TERM: "xterm-256color" } });

    expect(fake.spawned[0].opts.env).toEqual({ TERM: "xterm-256color", KEEP: "yes" });
  });

  test("supplies a cwd, because fancy-term-host requires one and a lane need not", () => {
    const fake = fakeBackend();
    const host = createFancyTermHost(fake.backend, { newId: predictableIds });

    host.open({});

    expect(typeof fake.spawned[0].opts.cwd).toBe("string");
    expect(fake.spawned[0].opts.cwd).not.toBe("");
  });

  test("delivers only its OWN terminal's output", async () => {
    // The backend fans every terminal through one callback. An adapter that
    // did not filter by id would hand each lane the others' output — and with
    // one terminal open, which is every simple test, it would look correct.
    const fake = fakeBackend();
    const host = createFancyTermHost(fake.backend, { newId: predictableIds });

    const first = await host.open({});
    const second = await host.open({});

    const heard: string[] = [];
    first.onData((chunk) => heard.push(chunk));

    fake.say("t2", "not yours\n");
    fake.say("t1", "yours\n");

    expect(heard).toEqual(["yours\n"]);
  });

  test("subscribes to the backend ONCE however many sessions are opened", async () => {
    // `PtyBackend` has `on` and no `off`, so a listener added per session could
    // never be removed — a long run would accumulate one dead listener per
    // terminal and Node would report a leak that is really ours.
    const fake = fakeBackend();
    const host = createFancyTermHost(fake.backend, { newId: predictableIds });

    const before = fake.subscriptions();
    await host.open({});
    await host.open({});
    await host.open({});

    expect(fake.subscriptions()).toBe(before);
  });

  test("unsubscribing one listener leaves the others attached", async () => {
    const fake = fakeBackend();
    const host = createFancyTermHost(fake.backend, { newId: predictableIds });
    const session = await host.open({});

    const a: string[] = [];
    const b: string[] = [];
    const offA = session.onData((c) => a.push(c));
    session.onData((c) => b.push(c));

    offA();
    fake.say("t1", "after\n");

    expect(a).toEqual([]);
    expect(b).toEqual(["after\n"]);
  });

  test("resolves `exited` with the code, and the signal as a NAME-shaped string", async () => {
    const fake = fakeBackend();
    const host = createFancyTermHost(fake.backend, { newId: predictableIds });
    const session = await host.open({});

    fake.exit("t1", 137, 9);

    await expect(session.exited).resolves.toEqual({ exitCode: 137, signal: "9" });
  });

  test("catches an exit that fires DURING create", async () => {
    // A shell that is not installed, or a bad cwd, dies immediately. An adapter
    // that subscribed after `create` would miss it, and the run would wait out
    // its whole timeout before reporting that a command "did not finish" —
    // about a process that never started.
    const immediate = fakeBackend();
    const dying: PtyBackendLike = {
      ...immediate.backend,
      create: (opts) => {
        const info = immediate.backend.create(opts);
        immediate.exit(opts.id, 127);
        return info;
      },
    };

    const host = createFancyTermHost(dying, { newId: predictableIds });
    const session = await host.open({ command: "no-such-shell" });

    await expect(session.exited).resolves.toMatchObject({ exitCode: 127 });
  });

  test("close kills the pty and settles `exited`", async () => {
    // Every wait races `exited`. Leaving it pending after a deliberate close
    // keeps a timer alive for a process that is already gone.
    const fake = fakeBackend();
    const host = createFancyTermHost(fake.backend, { newId: predictableIds });
    const session = await host.open({});

    await session.close();

    expect(fake.spawned[0].killed).toBe(true);
    await expect(session.exited).resolves.toMatchObject({ exitCode: 0 });
  });
});

describe("the adapter under a real run", () => {
  test("drives a terminal lane end to end", async () => {
    const fake = fakeBackend();
    const restore = registerTerminalHost(
      createFancyTermHost(fake.backend, { newId: predictableIds }),
    );

    const node = (id: string, type: string, config: Record<string, unknown>): FlowNode =>
      ({ id, type, position: { x: 0, y: 0 }, data: { label: id, config }, parentId: "lane" }) as unknown as FlowNode;

    const graph = {
      nodes: [
        { id: "lane", type: "@particle-academy/terminal_lane", position: { x: 0, y: 0 }, data: { label: "lane", config: { command: "bash", cwd: "/srv" } } },
        node("send", "terminal_send", { text: "status" }),
        node("wait", "terminal_await", { pattern: "READY", timeoutMs: 2000 }),
      ],
      edges: [{ id: "e1", source: "send", target: "wait" }],
    } as unknown as FlowGraph;

    const run = runFlow(graph, {});
    // Deliberately split, and split MID-WORD: the READY the await is looking
    // for spans two PTY writes, which is how a real one arrives.
    setTimeout(() => {
      fake.say("t1", "booting... REA");
      fake.say("t1", "DY\n");
    }, 5);

    const result = await run;

    expect(result.ok).toBe(true);
    // The lane's own command and cwd reached the backend — not a default.
    expect(fake.spawned[0].opts).toMatchObject({ shell: "bash", cwd: "/srv" });
    // Enter went as a carriage return.
    expect(fake.writes[0]).toEqual({ id: "t1", data: "status\r" });

    restore();
  });
});
