// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createElement, type ReactElement } from "react";

import { useResolvedColorMode, type FlowColorMode } from "../src/components/canvas/use-resolved-color-mode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The canvas must follow the app's theme when the host does not pin one.
 *
 * `colorMode` was passed straight to React Flow, so an unset prop meant React
 * Flow's own default — `light` — regardless of the surrounding app. Our `ff-`
 * styles hang off an ancestor `.dark` and still looked right, which is what
 * made this survive: the nodes we style were fine while React Flow's layer
 * underneath stayed light. A node kind with no registered type falls back to
 * React Flow's default node, and on a dark page that is a white box with
 * unreadable text.
 *
 * Verified on the live showcase before the fix: `.react-flow` carried the class
 * `light` while `<html>` was `dark`.
 *
 * This is a real behavioural test rather than a source assertion — the theme
 * signal is DOM attributes, which jsdom implements, unlike the layout and
 * cascade questions elsewhere in this suite.
 */
function mountHook(explicit?: FlowColorMode) {
  const seen: FlowColorMode[] = [];

  function Probe(): ReactElement | null {
    seen.push(useResolvedColorMode(explicit));
    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(Probe)));

  return {
    latest: () => seen[seen.length - 1]!,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useResolvedColorMode", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
  });

  it("follows a .dark class on the document", () => {
    document.documentElement.classList.add("dark");

    const h = mountHook();
    expect(h.latest()).toBe("dark");
    h.unmount();
  });

  it("follows data-theme", () => {
    document.documentElement.setAttribute("data-theme", "dark");

    const h = mountHook();
    expect(h.latest()).toBe("dark");
    h.unmount();
  });

  it("stays light when the app is light", () => {
    const h = mountHook();
    expect(h.latest()).toBe("light");
    h.unmount();
  });

  it("lets an explicit colorMode win over the app", () => {
    // A canvas deliberately pinned light on a dark page is a real use, and the
    // fix must not take it away.
    document.documentElement.classList.add("dark");

    const h = mountHook("light");
    expect(h.latest()).toBe("light");
    h.unmount();
  });

  it("REACTS to a theme toggle, not just the initial read", async () => {
    // The half that a one-shot read would miss. Flipping the theme changes an
    // attribute on <html>, which triggers no React render by itself — so
    // without the observer the canvas is right on load and wrong the instant
    // someone uses the toggle.
    //
    // `await act(async …)` rather than the sync form: MutationObserver delivers
    // on a microtask, so a synchronous act() returns before the callback has
    // run and the assertion reads the pre-toggle value.
    const h = mountHook();
    expect(h.latest()).toBe("light");

    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
      await Promise.resolve();
    });

    expect(h.latest()).toBe("dark");
    h.unmount();
  });
});
