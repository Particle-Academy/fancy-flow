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

describe("fancy-cms wiring (/rich-input entry)", () => {
  it("registers fancy-cms as the document engine on import", async () => {
    const mod = await import("../src/rich-input");
    // Importing the entry self-registers — a host writes one import line.
    expect(isRichInputEnabled()).toBe(true);
    const a = getRichInputAdapter()!;
    expect(a.renderDocument).toBeTypeOf("function");
    expect(a.renderEditor).toBeTypeOf("function");
    expect(a.FauxClient).toBeTruthy();
    dispose = mod.useFancyCmsForRichInput();
  });

  it("builds an empty doc that is a real fancy-cms PageDoc", async () => {
    const { emptyRichInputDoc, isPageDoc } = await import("../src/rich-input");
    const { emptyDoc } = await import("@particle-academy/fancy-cms-ui");

    const mine = emptyRichInputDoc("step-1");
    // Same shape the CMS itself produces — fancy-flow declares no doc schema.
    expect(Object.keys(mine).sort()).toEqual(Object.keys(emptyDoc("step-1")).sort());
    expect(isPageDoc(mine)).toBe(true);
  });

  it("rejects non-PageDoc values so a stray config can't reach the renderer", async () => {
    const { isPageDoc } = await import("../src/rich-input");
    expect(isPageDoc(null)).toBe(false);
    expect(isPageDoc("markdown")).toBe(false);
    expect(isPageDoc({ sections: [] })).toBe(false); // no nodes map
    expect(isPageDoc({ nodes: {} })).toBe(false); // no sections
  });

  it("scales the preview to a desktop width instead of reflowing it", async () => {
    const mod = await import("../src/rich-input");
    dispose = mod.useFancyCmsForRichInput();
    expect(getRichInputAdapter()?.frameProps).toMatchObject({ width: 1280, scale: "fit" });
  });
});
