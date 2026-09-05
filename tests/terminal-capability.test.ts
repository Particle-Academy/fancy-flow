import { describe, expect, test, vi } from "vitest";
import {
  getTerminalHost,
  registerTerminalHost,
  type TerminalHost,
  type TerminalSession,
} from "../src/registry/capabilities";

/**
 * The terminal capability seam.
 *
 * A terminal cannot live in the engine: `node-pty` is a native addon, so
 * importing it would break every browser build and force the dependency on
 * consumers who never run a terminal node. Core declares the contract; the
 * desktop app that can spawn a PTY registers one.
 *
 * These pin the SEAM rather than any terminal behaviour — that a host can be
 * installed, read back, and removed without leaving a stale reference behind.
 * The nodes that use it are a separate question, deliberately: this is the part
 * that is the same whatever they turn out to be.
 */

function fakeSession(): TerminalSession {
  return {
    id: "s1",
    write: vi.fn(),
    onData: () => () => {},
    exited: Promise.resolve({ exitCode: 0 }),
    close: vi.fn(),
  };
}

describe("terminal host capability", () => {
  test("is absent until a host registers one", () => {
    // The engine must be able to tell "no terminal available" from "a terminal
    // that does nothing" — a node in a terminal lane with no host has to fail
    // saying so, not hang waiting on output that can never arrive.
    const restore = getTerminalHost();
    if (restore) throw new Error("a host was already registered; test order is not isolated");

    expect(getTerminalHost()).toBeNull();
  });

  test("registers, reads back, and unregisters", () => {
    const host: TerminalHost = { open: () => fakeSession() };

    const unregister = registerTerminalHost(host);
    expect(getTerminalHost()).toBe(host);

    unregister();
    expect(getTerminalHost()).toBeNull();
  });

  test("unregistering a REPLACED host does not clear the current one", () => {
    // The subtle one, and the reason `registerLlmClient` is written the same
    // way. Two hosts registered in sequence leave the first's unregister
    // function in a caller's hands; calling it later must not silently remove
    // the second, which would leave the engine with no terminal and no event
    // saying one went away.
    const first: TerminalHost = { open: () => fakeSession() };
    const second: TerminalHost = { open: () => fakeSession() };

    const unregisterFirst = registerTerminalHost(first);
    const unregisterSecond = registerTerminalHost(second);

    unregisterFirst();

    expect(getTerminalHost()).toBe(second);

    unregisterSecond();
    expect(getTerminalHost()).toBeNull();
  });
});
