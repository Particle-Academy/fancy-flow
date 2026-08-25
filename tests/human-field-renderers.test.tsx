// @vitest-environment jsdom
/**
 * `humanFieldRenderers` — the opt-in seam for replacing pause-form controls.
 *
 * ## Why this seam exists
 *
 * Rule 2 of the suite ("Fancy Exclusive") says our own surfaces compose
 * react-fancy rather than hand-rolling what a primitive already covers. The
 * pause form does NOT, and that is a deliberate packaging decision rather than
 * an oversight: `@particle-academy/react-fancy` is an OPTIONAL peer of
 * fancy-flow and `HumanPrompt` ships in the main entry, so importing it there
 * would make a standalone `npm install @particle-academy/fancy-flow` fail to
 * resolve at import time — and react-fancy's primitives are hardcoded Tailwind
 * classes that read none of the `--ff-*` custom properties a host themes
 * `.ff-editor` with.
 *
 * So the built-ins stay native and themed, and a host that HAS react-fancy opts
 * into real Fancy controls with one prop. Same shape as the `fieldRenderers`
 * seam the config panel already has, and the same `null` convention: a renderer
 * returning `null` means "not mine", so a partial map is safe to hand over
 * wholesale.
 *
 * The tests below pin the properties that make the seam trustworthy — it is
 * reached, `null` falls back rather than rendering nothing, unclaimed types keep
 * their real control, and the whole thing is optional.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  HumanPrompt,
  type HumanField,
  type HumanPromptRequest,
} from "../src/components/FlowEditor/HumanPrompt";

afterEach(cleanup);

function inputRequest(fields: HumanField[]): HumanPromptRequest {
  return {
    kind: "input",
    title: "Details",
    fields,
    submitLabel: "Continue",
    resolve: () => {},
  } as HumanPromptRequest;
}

describe("humanFieldRenderers", () => {
  it("uses a host renderer in place of the built-in control", () => {
    const { container } = render(
      <HumanPrompt
        request={inputRequest([{ key: "email", label: "Email", type: "email" }])}
        onCancel={() => {}}
        fieldRenderers={{
          email: ({ id, field }) => <input id={id} data-ff-field={field.key} data-mine="yes" />,
        }}
      />,
    );

    expect(container.querySelector('[data-ff-field="email"]')?.getAttribute("data-mine")).toBe("yes");
  });

  it("falls back to the built-in when a renderer returns null", () => {
    // The `null` convention is what makes a partial map safe to spread. Without
    // it, a host spreading someone else's map would silently lose every field
    // that map declined — an empty row where a control belongs, which reads as
    // a rendering bug rather than a seam working as designed.
    const { container } = render(
      <HumanPrompt
        request={inputRequest([{ key: "note", label: "Note", type: "text" }])}
        onCancel={() => {}}
        fieldRenderers={{ text: () => null }}
      />,
    );

    const control = container.querySelector('[data-ff-field="note"]');
    expect(control).not.toBeNull();
    expect(control?.tagName).toBe("INPUT");
  });

  it("leaves types the map does not claim on their built-in control", () => {
    const { container } = render(
      <HumanPrompt
        request={inputRequest([
          { key: "email", label: "Email", type: "email" },
          { key: "agree", label: "Agree", type: "switch" },
        ])}
        onCancel={() => {}}
        fieldRenderers={{
          email: ({ id, field }) => <input id={id} data-ff-field={field.key} data-mine="yes" />,
        }}
      />,
    );

    expect(container.querySelector('[data-ff-field="email"]')?.getAttribute("data-mine")).toBe("yes");

    // The unclaimed one keeps its real control — not a text box, not nothing.
    const agree = container.querySelector('[data-ff-field="agree"]') as HTMLInputElement | null;
    expect(agree?.getAttribute("type")).toBe("checkbox");
  });

  it("still renders every field when no map is supplied at all", () => {
    // The control case. Without it the three above would pass against a
    // component that rendered nothing unless a renderer was given.
    const { container } = render(
      <HumanPrompt
        request={inputRequest([
          { key: "name", label: "Name", type: "text" },
          { key: "when", label: "When", type: "date" },
        ])}
        onCancel={() => {}}
      />,
    );

    expect(container.querySelector('[data-ff-field="name"]')).not.toBeNull();
    expect((container.querySelector('[data-ff-field="when"]') as HTMLInputElement).type).toBe("date");
  });
});
