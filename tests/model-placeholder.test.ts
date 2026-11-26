/**
 * The `model` placeholder names a current model.
 *
 * The LLM kinds suggested `claude-sonnet-4-5`, which retires on 2026-11-30. A
 * placeholder is what an author (or an agent reading the kind manifest) copies,
 * so a retired id there becomes a node that fails on its first call.
 */
import { beforeEach, expect, test } from "vitest";
import { listNodeKinds, resetNodeKindsForTests } from "../src/registry/registry";
import { registerBuiltinKinds } from "../src/registry/builtin";

const CURRENT = "claude-sonnet-5-5";

beforeEach(() => {
  resetNodeKindsForTests();
  registerBuiltinKinds();
});

test("every builtin model field suggests a current model", () => {
  const modelFields = listNodeKinds().flatMap((kind) =>
    (kind.configSchema ?? [])
      .filter((f) => f.key === "model")
      .map((f) => ({ kind: kind.name, placeholder: (f as { placeholder?: string }).placeholder })),
  );

  // Vacuity guard: llm_call and llm_router both declare a model field.
  expect(modelFields.length).toBeGreaterThanOrEqual(2);
  for (const f of modelFields) expect(f.placeholder, f.kind).toBe(CURRENT);
});

test("no builtin config field suggests claude-sonnet-4-5", () => {
  const text = JSON.stringify(listNodeKinds().map((k) => k.configSchema ?? []));
  expect(text).not.toContain("claude-sonnet-4-5");
});
