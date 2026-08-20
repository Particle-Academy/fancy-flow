/**
 * The builtin kinds must exist for anyone who touches the registry — not only
 * for consumers who happened to import the package ROOT.
 *
 * Registration used to be a bare `registerBuiltinKinds()` statement in
 * `src/index.ts`, so it fired only as an import side effect of that one entry.
 * Anyone reaching the registry another way got an EMPTY one:
 *
 *   import { getNodeKind } from "@particle-academy/fancy-flow/engine";  // 0 kinds
 *
 * and a type-only root import (`import { type FlowGraph } from "…/fancy-flow"`)
 * is erased at compile time, so it does not fire it either.
 *
 * An empty registry is not a loud failure. `FlowViewer` resolves each node with
 * `getNodeKind()`, gets null, and falls down its title chain to the raw kind id
 * — so the canvas renders `@particle-academy/llm_call` on the card. Nodes that
 * carry their own `data.label` still look perfect, which is why this reads as
 * "custom nodes work, builtins don't" rather than as a registry problem.
 *
 * This file deliberately imports the REGISTRY ONLY. Importing the package root
 * would fire the side effect and make it pass regardless.
 */
import { describe, expect, test } from "vitest";
import { getNodeKind, listNodeKinds, resolveKindId } from "../src/registry/registry";

describe("the registry populates itself", () => {
  test("a read resolves a builtin without the root entry being imported", () => {
    expect(getNodeKind("@particle-academy/llm_call")?.label).toBe("LLM Call");
  });

  test("bare aliases resolve too", () => {
    expect(resolveKindId("llm_call")).toBe("@particle-academy/llm_call");
  });

  test("listing sees the whole builtin kit", () => {
    expect(listNodeKinds().length).toBeGreaterThanOrEqual(27);
  });
});
