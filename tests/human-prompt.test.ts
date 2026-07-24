import { describe, expect, it } from "vitest";
import { humanInputFields } from "../src/components/FlowEditor/HumanPrompt";

describe("humanInputFields", () => {
  it("maps a user_input `fields` config into renderable fields", () => {
    const fields = humanInputFields({
      title: "Need info",
      fields: [
        { key: "name", label: "Your name", type: "text", required: true },
        { key: "bio", label: "About you", type: "textarea" },
        { key: "age", type: "number" },
      ],
    });
    expect(fields).toHaveLength(3);
    expect(fields[0]).toMatchObject({ key: "name", label: "Your name", type: "text", required: true });
    expect(fields[1]).toMatchObject({ key: "bio", type: "textarea" });
    // label falls back to the key; unknown/missing type falls back to text
    expect(fields[2]).toMatchObject({ key: "age", label: "age", type: "number", required: false });
  });

  it("falls back to a single required field when none are configured", () => {
    const fields = humanInputFields({ title: "What can I help with?" });
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ key: "value", label: "What can I help with?", type: "textarea", required: true });
  });

  it("drops rows without a usable key and coerces bad types to text", () => {
    const fields = humanInputFields({
      fields: [
        { label: "no key here" },
        { key: "", label: "empty key" },
        { key: "ok", type: "bogus" },
      ],
    });
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ key: "ok", type: "text" });
  });
});
