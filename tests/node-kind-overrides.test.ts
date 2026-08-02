import { afterEach, describe, expect, it } from "vitest";
import {
  clearNodeKindOverrides,
  getNodeKind,
  listNodeKinds,
  overrideNodeKind,
  registerNodeKind,
} from "../src/registry/registry";

const base = {
  name: "@test/http_request",
  category: "io" as const,
  label: "HTTP Request",
  description: "Send an HTTP request",
};

function register() {
  return registerNodeKind({ ...base, executor: async () => ({}) });
}

afterEach(() => {
  clearNodeKindOverrides();
});

describe("overrideNodeKind", () => {
  it("renames a kind a consumer did not author", () => {
    register();

    overrideNodeKind(base.name, { label: "Call an API", description: "Fetch or post JSON" });

    const kind = getNodeKind(base.name)!;
    expect(kind.label).toBe("Call an API");
    expect(kind.description).toBe("Fetch or post JSON");
  });

  it("leaves behaviour untouched", () => {
    register();
    const before = getNodeKind(base.name)!.executor;

    overrideNodeKind(base.name, { label: "Renamed" });

    // The whole point: an override is presentation. If it could reach the
    // executor it would desync the graph from the runtime that runs it.
    expect(getNodeKind(base.name)!.executor).toBe(before);
    expect(getNodeKind(base.name)!.name).toBe(base.name);
  });

  it("survives the base kind being re-registered", () => {
    register();
    overrideNodeKind(base.name, { label: "Call an API" });

    // HMR, a later registerBuiltinKinds(), or a package upgrade. Storing the
    // override inside the definition would let this silently revert the
    // consumer's naming.
    register();

    expect(getNodeKind(base.name)!.label).toBe("Call an API");
  });

  it("applies before category filtering, so a re-categorised node actually moves", () => {
    register();
    overrideNodeKind(base.name, { category: "ai" });

    expect(listNodeKinds("ai").map((k) => k.name)).toContain(base.name);
    expect(listNodeKinds("io").map((k) => k.name)).not.toContain(base.name);
  });

  it("takes effect on a kind registered afterwards", () => {
    // Order of module side effects is not something a consumer should have to
    // reason about — overriding before the kind exists must still land.
    overrideNodeKind(base.name, { label: "Early" });
    register();

    expect(getNodeKind(base.name)!.label).toBe("Early");
  });

  it("merges successive patches rather than replacing them", () => {
    register();
    overrideNodeKind(base.name, { label: "Call an API" });
    overrideNodeKind(base.name, { description: "Fetch or post JSON" });

    const kind = getNodeKind(base.name)!;
    expect(kind.label).toBe("Call an API");
    expect(kind.description).toBe("Fetch or post JSON");
  });

  it("undoes to the previous state, not to no state", () => {
    register();
    overrideNodeKind(base.name, { label: "First" });
    const undoSecond = overrideNodeKind(base.name, { label: "Second" });

    undoSecond();

    expect(getNodeKind(base.name)!.label).toBe("First");
  });

  it("restores the original label once every override is undone", () => {
    register();
    const undo = overrideNodeKind(base.name, { label: "Temporary" });

    undo();

    expect(getNodeKind(base.name)!.label).toBe("HTTP Request");
  });

  it("resolves an alias to the canonical kind", () => {
    registerNodeKind({ ...base, aliases: ["http_request"], executor: async () => ({}) });

    overrideNodeKind("http_request", { label: "Via alias" });

    expect(getNodeKind(base.name)!.label).toBe("Via alias");
  });
});
