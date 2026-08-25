// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HumanPrompt, humanInputFields, type HumanPromptRequest } from "../src/components/FlowEditor/HumanPrompt";
import { registerBuiltinKinds } from "../src/registry/builtin";
import { getNodeKind } from "../src/registry/registry";

/**
 * The runtime form a `user_input` node pauses a run on must render each field
 * as the control its DECLARED TYPE asks for.
 *
 * It did not. `humanInputFields` accepted exactly five type names and coerced
 * everything else to `text`, so a field declared `boolean`, `date`, `email` or
 * `enum` — every name an author, a peer runtime or an agent would reasonably
 * emit — arrived at the form as a plain text box. A `select` whose choices were
 * written as bare strings (the shorthand `TextConfigField.choices` already
 * accepts everywhere else in this package) rendered a dropdown of blank
 * options, and a `select` with no choices at all fell through to a text input.
 *
 * The person filling the form is the last line of a paused run. Handing them
 * the wrong control means the value that resumes the run is the wrong TYPE —
 * a date as free text, a boolean as the string "true" — and nothing downstream
 * reports it, because a string is a perfectly good string.
 */
afterEach(cleanup);

function promptFor(fields: unknown[], resolve = vi.fn()) {
  const request: HumanPromptRequest = {
    kind: "input",
    title: "Tell us about you",
    fields: humanInputFields({ fields }),
    resolve,
  };
  return render(<HumanPrompt request={request} onCancel={vi.fn()} />);
}

const control = (label: string) => screen.getByLabelText(new RegExp(`^${label}`)) as HTMLInputElement;

describe("HumanPrompt renders each field as its declared type", () => {
  // [declared type, expected input[type], field key]. The first two are what
  // the title interpolates, so a case reads as the assertion it makes.
  it.each([
    ["date", "date", "birthday"],
    ["datetime", "datetime-local", "starts_at"],
    ["time", "time", "reminder"],
    ["email", "email", "contact"],
    ["url", "url", "homepage"],
    ["tel", "tel", "phone"],
    ["password", "password", "secret"],
    ["number", "number", "age"],
  ])("renders a %s field as input[type=%s]", (declared, expected, key) => {
    promptFor([{ key, label: key, type: declared }]);

    expect(control(key).getAttribute("type")).toBe(expected);
  });

  it.each([
    ["boolean", "agree"],
    ["bool", "agree"],
    ["checkbox", "agree"],
    ["toggle", "agree"],
    ["switch", "agree"],
  ])("renders a %s field as a checkbox", (declared, key) => {
    promptFor([{ key, label: key, type: declared }]);

    expect(control(key).getAttribute("type")).toBe("checkbox");
  });

  it.each([
    ["long_text", "bio"],
    ["multiline", "bio"],
    ["textarea", "bio"],
  ])("renders a %s field as a textarea", (declared, key) => {
    promptFor([{ key, label: key, type: declared }]);

    expect(control(key).tagName).toBe("TEXTAREA");
  });

  it.each([["enum"], ["choice"], ["dropdown"], ["select"]])(
    "renders a %s field as a select carrying its options",
    (declared) => {
      promptFor([
        { key: "size", label: "size", type: declared, options: [{ value: "s", label: "Small" }, { value: "l", label: "Large" }] },
      ]);

      const el = control("size");
      expect(el.tagName).toBe("SELECT");
      expect(Array.from(el.querySelectorAll("option")).map((o) => o.getAttribute("value"))).toEqual(["", "s", "l"]);
    },
  );

  it("accepts bare-string options as shorthand, like `choices` elsewhere", () => {
    promptFor([{ key: "size", label: "size", type: "select", options: ["small", "large"] }]);

    const opts = Array.from(control("size").querySelectorAll("option")).slice(1);
    expect(opts.map((o) => o.getAttribute("value"))).toEqual(["small", "large"]);
    expect(opts.map((o) => o.textContent)).toEqual(["small", "large"]);
  });

  it("still renders a select when its options are missing, rather than a text box", () => {
    // A select with nothing to choose is an authoring mistake. Quietly turning
    // it into a free-text input hides the mistake AND collects an unconstrained
    // value the downstream node was told to expect from a fixed list.
    promptFor([{ key: "size", label: "size", type: "select" }]);

    expect(control("size").tagName).toBe("SELECT");
  });

  it("falls back to text for a type it does not recognise, without dropping the field", () => {
    promptFor([{ key: "mystery", label: "mystery", type: "quantum" }]);

    const el = control("mystery");
    expect(el.tagName).toBe("INPUT");
    expect(el.getAttribute("type")).toBe("text");
  });

  it("gives every control a stable handle keyed by its field, and a unique id", () => {
    // The Human+ contract: an agent targets `[data-ff-field="agree"]`, never a
    // guessed DOM path. Two prompts on one page must not share ids.
    const { container } = promptFor([
      { key: "name", label: "name", type: "text" },
      { key: "agree", label: "agree", type: "boolean" },
      { key: "size", label: "size", type: "select", options: ["s"] },
      { key: "bio", label: "bio", type: "textarea" },
    ]);

    expect(
      Array.from(container.querySelectorAll("[data-ff-field]")).map((el) => el.getAttribute("data-ff-field")),
    ).toEqual(["name", "agree", "size", "bio"]);
    expect(container.querySelector('[data-ff-field="name"]')?.getAttribute("id")).toBeTruthy();

    const second = promptFor([{ key: "name", label: "name", type: "text" }]);
    expect(container.querySelector('[data-ff-field="name"]')?.getAttribute("id")).not.toBe(
      second.container.querySelector('[data-ff-field="name"]')?.getAttribute("id"),
    );
  });

  it("resolves values in the type the field declared", () => {
    const resolve = vi.fn();
    promptFor(
      [
        { key: "age", label: "age", type: "integer" },
        { key: "agree", label: "agree", type: "boolean" },
        { key: "birthday", label: "birthday", type: "date" },
      ],
      resolve,
    );

    fireEvent.change(control("age"), { target: { value: "41" } });
    fireEvent.click(control("agree"));
    fireEvent.change(control("birthday"), { target: { value: "1984-06-21" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(resolve).toHaveBeenCalledWith({ age: 41, agree: true, birthday: "1984-06-21" });
  });
  it("starts a number field on a number, even when its default was written as a string", () => {
    // An untouched field resolves its default verbatim, so a string default on
    // a number field resumed the run with a string nobody typed.
    const resolve = vi.fn();
    promptFor([{ key: "retries", label: "retries", type: "number", default: "5" }], resolve);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(resolve).toHaveBeenCalledWith({ retries: 5 });
  });
});

describe("humanInputFields normalizes the declared vocabulary", () => {
  it("maps aliases onto the canonical control type", () => {
    const fields = humanInputFields({
      fields: [
        { key: "a", type: "string" },
        { key: "b", type: "integer" },
        { key: "c", type: "bool" },
        { key: "d", type: "enum", options: ["x"] },
        { key: "e", type: "long_text" },
        { key: "f", type: "datetime-local" },
      ],
    });

    expect(fields.map((f) => f.type)).toEqual(["text", "number", "switch", "select", "textarea", "datetime"]);
  });

  it("keeps an unrecognised type renderable as text", () => {
    const [field] = humanInputFields({ fields: [{ key: "ok", type: "bogus" }] });

    expect(field).toMatchObject({ key: "ok", type: "text" });
  });
});

describe("the user_input node can AUTHOR every type the form renders", () => {
  // A control the runtime supports but the config panel cannot select is wired
  // to nothing: the only way to reach it would be hand-editing the workflow
  // JSON, which is exactly the audience the panel exists for.
  beforeAll(() => registerBuiltinKinds());

  const kind = () =>
    getNodeKind("@particle-academy/user_input") as unknown as {
      configSchema: Array<Record<string, any>>;
      outputShape: (config: Record<string, unknown>) => Array<{ path: string; type?: string }>;
    };
  const rows = () => (kind().configSchema.find((f) => f.key === "fields") as any).fields as Array<Record<string, any>>;

  it("offers every canonical control in the field-type picker", () => {
    const offered = (rows().find((f) => f.key === "type") as any).options.map((o: any) => o.value);

    expect(new Set(offered)).toEqual(
      new Set(["text", "textarea", "number", "select", "switch", "date", "datetime", "time", "email", "url", "tel", "password"]),
    );
  });

  it("lets an author give a select its choices", () => {
    // Without this the panel could declare `type: select` and never say what to
    // choose from, so every authored select was an empty dropdown.
    expect(rows().find((f) => f.key === "options")).toBeTruthy();
  });

  it("reports each field's real type in the variable picker", () => {
    const shape = kind().outputShape({
      fields: [
        { key: "age", label: "Age", type: "number" },
        { key: "agree", type: "boolean" },
        { key: "name", type: "text" },
      ],
    });

    expect(shape).toEqual([
      { path: "age", type: "number", description: "Age" },
      { path: "agree", type: "boolean", description: undefined },
      { path: "name", type: "string", description: undefined },
    ]);
  });
});
