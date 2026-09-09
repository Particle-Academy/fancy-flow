// @vitest-environment jsdom
/**
 * `showPalette` / `showPanel` must change the COLUMNS, not just the children.
 *
 * ## The bug (#16), reported from an app embedding the editor
 *
 * `.ff-editor` was a fixed three-column grid — `216px 1fr 300px` — and the two
 * side panes were rendered conditionally. So `showPalette={false}` removed the
 * palette and left three columns with two children: **the canvas landed in the
 * 216px column and the 300px column sat empty beside it.** The props were only
 * usable in the one combination the media queries happened to produce.
 *
 * The second half is worse and is why this is a container problem rather than a
 * styling one. The responsive rules were **viewport** `@media` queries that hid
 * panes with `display: none`:
 *
 * - **Wrong axis.** The editor is rarely the viewport — the reporter embeds it
 *   as a tab in one window and the body of another. The query fires against a
 *   width the editor never had: too late in a narrow container inside a wide
 *   window, too early the other way.
 * - **`display: none` outranks the host.** A host that renders the pane and
 *   positions it itself still got it hidden, because a stylesheet rule beats a
 *   prop that has no rule of its own. They were carrying
 *   `.our-shell .ff-editor__panel-wrap { display: flex }` to undo ours.
 * - **No way back.** Below 720px the palette was gone and nothing offered to
 *   return it, so a narrow editor could not have a node added to it at all.
 *   That is not a smaller editor, it is a broken one.
 *
 * ## What this file can and cannot check
 *
 * jsdom does not evaluate `@media` or `@container`, so the QUERIES are not
 * testable here — saying so matters, because a test that appears to cover them
 * and does not is worse than none.
 *
 * What IS testable is the seam the fix turns on: **which state the root element
 * declares.** Once "which panes exist" has exactly one source of truth on the
 * root, the stylesheet is a pure function of it, and the host can drive it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FlowEditor } from "../src/components/FlowEditor/FlowEditor";
import { registerBuiltinKinds } from "../src/registry/builtin";

// React Flow measures its container, and jsdom has no ResizeObserver. Same stub
// the other editor tests use.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

/**
 * The shipped stylesheet, read as TEXT — jsdom evaluates no queries.
 *
 * Resolved from cwd rather than `import.meta.url`: under the jsdom environment
 * that URL is `http://localhost/...`, so `fileURLToPath` rejects it and the
 * whole FILE fails to collect — which reports as "no tests" rather than as a
 * failure, and a suite that collects nothing is the quietest way to have no
 * coverage at all.
 */
const STYLES = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

const root = (host: HTMLElement) => host.querySelector(".ff-editor") as HTMLElement;

beforeEach(() => registerBuiltinKinds());
afterEach(cleanup);

describe("the root element declares which panes exist", () => {
  test("both panes shown: no modifier, the default three columns", () => {
    const { container } = render(<FlowEditor />);

    expect(root(container).className).not.toMatch(/ff-editor--no-/);
    expect(container.querySelector(".ff-editor__palette")).not.toBeNull();
  });

  test("showPalette={false} marks the root, so the columns can follow", () => {
    const { container } = render(<FlowEditor showPalette={false} />);

    expect(root(container).className).toContain("ff-editor--no-palette");
    expect(root(container).className).not.toContain("ff-editor--no-panel");
    // and the pane really is gone, not merely unstyled
    expect(container.querySelector(".ff-editor__palette")).toBeNull();
  });

  test("showPanel={false} marks the root", () => {
    const { container } = render(<FlowEditor showPanel={false} />);

    expect(root(container).className).toContain("ff-editor--no-panel");
    expect(root(container).className).not.toContain("ff-editor--no-palette");
  });

  test("both off: both modifiers, which is the single-column case", () => {
    const { container } = render(<FlowEditor showPalette={false} showPanel={false} />);

    const cls = root(container).className;
    expect(cls).toContain("ff-editor--no-palette");
    expect(cls).toContain("ff-editor--no-panel");
  });

  test("a host's own className survives the modifiers", () => {
    // The reporter wraps the editor in their own shell and selects on it. If
    // adding modifiers dropped consumer classes, the fix would break the very
    // hosts it is for.
    const { container } = render(<FlowEditor className="our-shell" showPalette={false} />);

    const cls = root(container).className;
    expect(cls).toContain("our-shell");
    expect(cls).toContain("ff-editor--no-palette");
  });
});

describe("the stylesheet is a function of that state", () => {
  test("every pane combination has a column rule, and none uses display:none on a pane", () => {
    // Read the shipped stylesheet as TEXT. jsdom will not evaluate the queries,
    // so this asserts the RULES exist rather than that they applied — the
    // honest limit of what can be checked here.
    const css = STYLES;

    expect(css, "no rule for the palette-hidden case").toMatch(/\.ff-editor--no-palette\s*\{[^}]*grid-template-columns/);
    expect(css, "no rule for the panel-hidden case").toMatch(/\.ff-editor--no-panel\s*\{[^}]*grid-template-columns/);

    // The regression that started this: a viewport query hiding a pane the host
    // asked for. Container queries may resize; they must not un-render.
    const hidesPanes = /@media[^{]*\{[^@]*\.ff-editor__(palette|panel-wrap)\s*\{[^}]*display:\s*none/s.test(css);
    expect(hidesPanes, "a media query still hides a pane with display:none — that beats the host's prop").toBe(false);
  });

  test("the responsive rules are CONTAINER-relative, not viewport", () => {
    // The wrong-axis half of #16. The editor is rarely the viewport.
    const css = STYLES;

    expect(css, "no container-type on the editor, so @container cannot apply").toMatch(
      /\.ff-editor\s*\{[^}]*container-type:\s*inline-size/,
    );
    expect(css, "no @container rules for the editor").toMatch(/@container[^{]*\{/);
  });
});
