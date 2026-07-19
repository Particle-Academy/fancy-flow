import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRichInputAdapter,
  isRichInputEnabled,
  onRichInputAdapterChanged,
  registerRichInputAdapter,
} from "../src/registry/rich-input";
import { getNodeKind, validateConfig } from "../src/registry/registry";
import { registerBuiltinKinds } from "../src/registry/builtin";

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
});

describe("rich input adapter", () => {
  it("reports disabled until a host registers one", () => {
    expect(isRichInputEnabled()).toBe(false);
    expect(getRichInputAdapter()).toBeNull();
  });

  it("enables once an editor or renderer is supplied", () => {
    dispose = registerRichInputAdapter({ renderDocument: () => null });
    expect(isRichInputEnabled()).toBe(true);
  });

  it("stays disabled for an adapter that supplies neither", () => {
    // A FauxClient alone can frame a preview but cannot render or author the
    // document, so the node would still be unusable — don't claim enabled.
    dispose = registerRichInputAdapter({ FauxClient: () => null });
    expect(isRichInputEnabled()).toBe(false);
  });

  it("unregisters cleanly", () => {
    const off = registerRichInputAdapter({ renderDocument: () => null });
    off();
    expect(isRichInputEnabled()).toBe(false);
    expect(getRichInputAdapter()).toBeNull();
  });

  it("does not clobber a newer adapter when an older dispose fires", () => {
    const off1 = registerRichInputAdapter({ renderDocument: () => "one" });
    dispose = registerRichInputAdapter({ renderDocument: () => "two" });
    off1(); // late cleanup from the first registration
    expect(getRichInputAdapter()?.renderDocument?.(null)).toBe("two");
  });

  it("notifies subscribers so mounted nodes re-render", () => {
    let hits = 0;
    const off = onRichInputAdapterChanged(() => hits++);
    dispose = registerRichInputAdapter({ renderDocument: () => null });
    expect(hits).toBe(1);
    off();
  });
});

describe("rich_user_input node kind", () => {
  beforeEach(() => registerBuiltinKinds());

  it("is registered with a document field the host editor fills", () => {
    const kind = getNodeKind("rich_user_input")!;
    expect(kind.category).toBe("human");
    const doc = kind.configSchema?.find((f) => f.key === "document");
    expect(doc?.type).toBe("document");
    expect((doc as any).documentType).toBe("stages");
  });

  it("renders a node body even with no adapter and no content", () => {
    // The canvas must never show an empty card — that reads as broken.
    const kind = getNodeKind("rich_user_input")!;
    const body = kind.renderBody?.({ nodeId: "n1", config: {} as any, selected: false });
    expect(body).toBeTruthy();
  });

  it("treats an unauthored document as valid config", () => {
    const kind = getNodeKind("rich_user_input")!;
    expect(validateConfig(kind, { title: "Review" })).toEqual([]);
  });

  it("leaves the document shape opaque to fancy-flow", () => {
    // fancy-flow stores it and never interprets it, so anything round-trips.
    const kind = getNodeKind("rich_user_input")!;
    expect(validateConfig(kind, { document: { blocks: [1, 2, 3] } })).toEqual([]);
    expect(validateConfig(kind, { document: "raw markdown" })).toEqual([]);
  });
});
