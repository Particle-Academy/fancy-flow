import { useEffect, useState } from "react";

/** The resolved mode React Flow and our own `ff-` tokens both understand. */
export type FlowColorMode = "light" | "dark";

/**
 * What a host may PASS. React Flow's own `ColorMode` includes `"system"`, and
 * it is meaningful here rather than something to cast away: it means "follow
 * the environment", which is the same job `undefined` now does.
 */
export type FlowColorModeInput = FlowColorMode | "system";

/**
 * Read the app's theme off the document, the way every host in this suite
 * signals it.
 *
 * Checked in the order a host actually sets them: an explicit `data-theme`
 * beats a `.dark` class (a host that writes both, like the showcase, is
 * consistent either way), and only when neither is present does the OS
 * preference decide.
 */
function readDocumentTheme(): FlowColorMode {
  if (typeof document === "undefined") return "light";

  const root = document.documentElement;
  const attr = root.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  if (root.classList.contains("dark")) return "dark";

  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * The colour mode the canvas should actually use.
 *
 * **Why this exists.** `colorMode` used to be passed straight through to React
 * Flow, so a host that did not supply one got React Flow's own default —
 * `light` — no matter what the surrounding app was doing. Our `ff-` styles
 * still looked right, because they hang off an ancestor `.dark`, which is
 * exactly what made the bug hard to see: the nodes we style were fine while
 * React Flow's own layer stayed light underneath. Any node whose kind is not
 * registered falls back to React Flow's default node, and on a dark page that
 * is a white box with unreadable text. Edges, handles, the selection rectangle
 * and the controls were light too.
 *
 * So an unset `colorMode` now means "follow the app", not "light". Passing one
 * explicitly still wins — a canvas deliberately pinned light on a dark page is
 * a real thing, and this does not take it away.
 *
 * The subscription matters as much as the initial read: a theme toggle changes
 * an attribute on `<html>`, which triggers no React render on its own, so
 * without an observer the canvas would be correct on load and wrong the moment
 * someone flipped the switch.
 */
export function useResolvedColorMode(explicit?: FlowColorModeInput): FlowColorMode {
  // Start light on the server and on first paint. Reading the DOM in the
  // initialiser would differ between server and client markup and trip
  // hydration; the effect below corrects it before anything is visible.
  const [resolved, setResolved] = useState<FlowColorMode>("light");

  // `"system"` is treated exactly like an unset prop: both mean "follow the
  // environment", and collapsing them here keeps one resolution path.
  const pinned = explicit === "light" || explicit === "dark" ? explicit : undefined;

  useEffect(() => {
    if (pinned) return;
    if (typeof document === "undefined") return;

    const sync = () => setResolved(readDocumentTheme());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", sync);

    return () => {
      observer.disconnect();
      media?.removeEventListener?.("change", sync);
    };
  }, [pinned]);

  return pinned ?? resolved;
}
