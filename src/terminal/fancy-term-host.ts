/**
 * A `TerminalHost` backed by `@particle-academy/fancy-term-host`.
 *
 * ## Why this takes the backend as an argument instead of importing it
 *
 * `fancy-term-host` declares `node-pty` as a REQUIRED peer, and its `manager.ts`
 * imports it at module scope — so importing the package at all pulls a native
 * addon in at load time. Depending on it here, even as a devDependency for the
 * types, would put a native build in fancy-flow's own CI install on every
 * platform, for a package that does not otherwise need one.
 *
 * The consumer who wants this adapter is a desktop app that has already wired
 * `fancy-term-host` and holds a live backend. Handing it in costs them one
 * argument and costs everyone else nothing:
 *
 * ```ts
 * import { terminalManager } from "@particle-academy/fancy-term-host";
 * import { useFancyTermHost } from "@particle-academy/fancy-flow/terminal/fancy-term-host";
 *
 * useFancyTermHost(terminalManager());
 * ```
 *
 * `PtyBackend` satisfies `PtyBackendLike` structurally — verified against
 * `fancy-term-host@0.5.0`, `src/backend.ts`. The narrow shape below is the
 * whole of what this adapter touches, which is what keeps that claim small
 * enough to re-check.
 */

import { registerTerminalHost, type TerminalHost, type TerminalSession, type TerminalSessionSpec } from "../registry/capabilities";

/** The slice of `fancy-term-host`'s `PtyBackend` this adapter uses. */
export type PtyBackendLike = {
  create(opts: {
    id: string;
    cwd: string;
    shell?: string;
    args?: string[];
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
  }): { id: string; pid: number; shell: string };
  write(id: string, data: string): boolean;
  kill(id: string): boolean;
  on(event: "data", listener: (id: string, data: string) => void): unknown;
  on(event: "exit", listener: (id: string, payload: { exitCode: number; signal?: number }) => void): unknown;
};

/** Applied when a lane does not declare its own. */
export type FancyTermHostDefaults = {
  /** Where a lane's shell starts. `fancy-term-host` requires one; this supplies it. */
  cwd?: string;
  /** Extra args for the shell a lane names. */
  args?: string[];
  /** Merged UNDER the lane's own env, so a lane can override a default. */
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  /** Ids for new sessions. Override in a test that wants them predictable. */
  newId?: () => string;
};

/**
 * One fan-out per backend.
 *
 * `PtyBackend` exposes `on` and no `off`, so a listener added per session could
 * never be removed — a long run would accumulate one dead listener per terminal
 * it opened, and Node would eventually warn about a leak that is really ours.
 *
 * So each backend is subscribed to exactly ONCE and the per-session listeners
 * live in a map this module controls, where unsubscribing is just a delete.
 * Keyed weakly, so a backend that goes out of scope is not retained by us.
 */
type Fanout = {
  data: Map<string, Set<(chunk: string) => void>>;
  exit: Map<string, (exit: { exitCode: number; signal?: string }) => void>;
};

const fanouts = new WeakMap<PtyBackendLike, Fanout>();

function fanoutFor(backend: PtyBackendLike): Fanout {
  const existing = fanouts.get(backend);
  if (existing) return existing;

  const fanout: Fanout = { data: new Map(), exit: new Map() };
  fanouts.set(backend, fanout);

  backend.on("data", (id, chunk) => {
    const listeners = fanout.data.get(id);
    if (!listeners) return;
    // Copied before iterating: a listener that unsubscribes itself while being
    // notified would otherwise mutate the set mid-iteration.
    for (const listener of [...listeners]) listener(chunk);
  });

  backend.on("exit", (id, payload) => {
    fanout.exit.get(id)?.({
      exitCode: payload.exitCode,
      // fancy-term-host reports a signal NUMBER; `TerminalExit.signal` is a
      // string, because a signal is a name everywhere a person reads one.
      signal: payload.signal === undefined ? undefined : String(payload.signal),
    });
    fanout.exit.delete(id);
    fanout.data.delete(id);
  });

  return fanout;
}

/**
 * The process's working directory, without depending on `@types/node`.
 *
 * fancy-flow builds for the browser too and carries no Node types, so `process`
 * is not a name this package can reference directly. Reached through
 * `globalThis` it stays honest in both places: a real answer where there is a
 * process, and `"."` where there is not, rather than a build that only compiles
 * in one of them.
 */
function runtimeCwd(): string {
  const proc = (globalThis as { process?: { cwd?: () => string } }).process;
  return typeof proc?.cwd === "function" ? proc.cwd() : ".";
}

let counter = 0;

function defaultNewId(): string {
  counter += 1;
  return `flow-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Build a `TerminalHost` over a `fancy-term-host` backend. */
export function createFancyTermHost(
  backend: PtyBackendLike,
  defaults: FancyTermHostDefaults = {},
): TerminalHost {
  const fanout = fanoutFor(backend);
  const newId = defaults.newId ?? defaultNewId;

  return {
    open: (spec: TerminalSessionSpec): TerminalSession => {
      const id = newId();

      // Registered BEFORE `create`, not after. A shell that dies immediately —
      // a bad `cwd`, a shell that is not installed — emits `exit` during or
      // right after the spawn, and a listener attached afterwards would miss
      // it. The run would then wait out its full timeout and report "the
      // command did not finish" about a process that never started.
      let settleExit: (exit: { exitCode: number; signal?: string }) => void = () => {};
      const exited = new Promise<{ exitCode: number; signal?: string }>((resolve) => {
        settleExit = resolve;
      });
      fanout.exit.set(id, settleExit);

      const listeners = new Set<(chunk: string) => void>();
      fanout.data.set(id, listeners);

      const info = backend.create({
        id,
        // Required by `CreateTerminalOpts`, optional in a lane's config —
        // `process.cwd()` is the same default a person typing in a terminal
        // would get.
        cwd: spec.cwd ?? defaults.cwd ?? runtimeCwd(),
        shell: spec.command ?? undefined,
        args: spec.args ?? defaults.args,
        cols: spec.cols ?? defaults.cols,
        rows: spec.rows ?? defaults.rows,
        // The lane's own env wins: a default exists to fill a gap, not to
        // override something an author wrote on the node.
        env: { ...defaults.env, ...spec.env },
      });

      return {
        id: info.id,
        write: (data) => { backend.write(id, data); },
        onData: (listener) => {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
        exited,
        close: () => {
          backend.kill(id);
          fanout.data.delete(id);
          // Resolve rather than leave hanging. `exited` is raced by every wait,
          // so an unresolved promise after a deliberate close would keep a
          // pending timer alive for nothing.
          settleExit({ exitCode: 0 });
          fanout.exit.delete(id);
        },
      };
    },
  };
}

/**
 * Install it. Returns the unregister function, exactly as
 * `registerTerminalHost` does.
 */
export function useFancyTermHost(
  backend: PtyBackendLike,
  defaults: FancyTermHostDefaults = {},
): () => void {
  return registerTerminalHost(createFancyTermHost(backend, defaults));
}
