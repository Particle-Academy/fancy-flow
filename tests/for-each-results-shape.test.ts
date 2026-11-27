/**
 * `for_each` says what a `results` entry looks like.
 *
 * Each entry is that iteration's node outputs KEYED BY NODE ID, and a failed
 * item's entry is null. An authoring agent reads this text (the editor's panel,
 * fancy-flow-mcp-js's describe_node_kind), and a builder in lab run 1406 wrote
 * `{{ in.results.0.total }}` where the value is at `results.0.score-1.total`.
 * Kept identical in meaning to the PHP, Python and Rust declarations.
 */
import { beforeEach, expect, test } from "vitest";
import { getNodeKind, resetNodeKindsForTests } from "../src/registry/registry";
import { registerBuiltinKinds } from "../src/registry/builtin";

beforeEach(() => {
  resetNodeKindsForTests();
  registerBuiltinKinds();
});

function resultsField(): { description?: string } | undefined {
  const shape = getNodeKind("for_each")!.outputShape;
  const fields = typeof shape === "function" ? shape({}) : shape;
  return (fields ?? []).find((f) => f.path === "results") as { description?: string } | undefined;
}

test("the results field names the keyed shape and the null for a failed item", () => {
  const text = resultsField()?.description ?? "";
  expect(text).toContain("keyed by node id");
  expect(text).toContain("results.0.<node-id>.<field>");
  expect(text).toContain("null");
});

test("the kind description says the same", () => {
  const text = getNodeKind("for_each")!.description ?? "";
  expect(text).toContain("keyed by node id");
  expect(text).toContain("results.0.<node-id>.<field>");
});
