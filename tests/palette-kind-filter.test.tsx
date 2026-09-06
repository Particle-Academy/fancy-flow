// @vitest-environment jsdom
/**
 * A host must be able to offer a SUBSET of the registered vocabulary.
 *
 * `NodePalette` filtered by category and nothing else, so a host whose runtime
 * cannot support a particular kind had no supported way to stop offering it.
 * The consumer who reported this (#14) cannot yet RESUME a paused run, so
 * `human_approval` / `user_input` / `rich_user_input` would park a flow
 * forever — and with no per-kind filter they stayed in the palette and had to
 * be refused at three later points instead.
 *
 * They explicitly did NOT work around it: `overrideNodeKind` would have let
 * them re-categorise their OWN nodes until a category filter happened to
 * exclude ours, which distorts a host's taxonomy to hide a gap in ours.
 *
 * Mirrors `fieldFilter` on `NodeConfigPanel` (#8) deliberately — same
 * presentation-only contract, one level up, forwarded through `FlowEditor` the
 * same way.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { NodePalette } from "../src/components/NodePalette/NodePalette";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { registerNodeKind } from "../src/registry/registry";

/** The labels the palette is currently offering. */
function offered(host: HTMLElement): string[] {
  return [...host.querySelectorAll(".ff-palette__row-label")].map((n) => n.textContent ?? "");
}

beforeEach(() => {
  registerBuiltinKinds();
});

afterEach(cleanup);

describe("NodePalette kindFilter", () => {
  test("omits the kinds a host cannot support", () => {
    const paused = ["@particle-academy/user_input", "@particle-academy/human_approval"];

    const all = render(<NodePalette />).container;
    const withFilter = render(
      <NodePalette kindFilter={({ kind }) => !paused.includes(kind.name)} />,
    ).container;

    // The kinds really are on offer without the filter, or this test would
    // pass against a palette that renders nothing at all.
    expect(offered(all)).toContain("User Input");
    expect(offered(all)).toContain("Human Approval");

    expect(offered(withFilter)).not.toContain("User Input");
    expect(offered(withFilter)).not.toContain("Human Approval");
    // and nothing else went with them
    expect(offered(withFilter)).toContain("Manual");
  });

  test("a hidden kind does not come back when somebody searches for it", () => {
    // The one moment a host hiding an unsupported kind most needs it hidden is
    // the moment a person types its name. Filtering search-first would let it
    // reappear exactly then.
    const host = render(
      <NodePalette kindFilter={({ kind }) => kind.name !== "@particle-academy/user_input"} />,
    ).container;

    const search = host.querySelector<HTMLInputElement>(".ff-palette__search-input")!;
    act(() => {
      search.value = "user input";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(offered(host)).not.toContain("User Input");
  });

  test("serves a kind the host registered itself", () => {
    // A list of ids would not do: the palette cannot know the names of custom
    // kinds a host registers, or of kinds vendored in from the marketplace.
    registerNodeKind({
      name: "@acme/secret_step",
      category: "custom",
      label: "Secret Step",
      inputs: [{ id: "in" }],
      outputs: [{ id: "out" }],
    });

    const shown = render(<NodePalette />).container;
    const hidden = render(
      <NodePalette kindFilter={({ kind }) => !kind.name.startsWith("@acme/")} />,
    ).container;

    expect(offered(shown)).toContain("Secret Step");
    expect(offered(hidden)).not.toContain("Secret Step");
  });

  test("no filter offers everything, unchanged", () => {
    const host = render(<NodePalette />).container;
    expect(offered(host).length).toBeGreaterThan(20);
  });
});
