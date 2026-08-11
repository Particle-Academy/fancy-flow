import { describe, expect, it, beforeAll } from "vitest";
import { registerNodeKind } from "../src/registry";
import { availableVariables, describeExpressionGrammar } from "../src/expressions/variables";
import type { FlowGraph } from "../src/types";

/**
 * What an author can actually write in a `{{ }}` field, at a specific node.
 *
 * The panel labelled expression fields "supports `{{ in }}`" and stopped there:
 * no list of what is reachable, no explanation of the grammar. An author had to
 * already know both the syntax and the shape of the upstream node's output.
 * (Issue #5.)
 *
 * ## The grammar is NOT invented here
 *
 * fancy-flow's own runtime does not interpolate anything — `runFlow` hands the
 * node's config to the executor verbatim. The semantics that exist are the PHP
 * twin's `FancyFlow\Nodes\Support\Expr`, and they are what this mirrors:
 *
 *   - `{{ $json.a.b }}` / `{{ $input.a.b }}` — dot-path into the `in` port value
 *   - `{{ in.a.b }}`                        — the same value by its context key
 *   - dot-paths only; no arbitrary code
 *
 * Offering a variable the resolver could not reach would be worse than offering
 * nothing, so every suggestion is expressed in that grammar.
 *
 * ## Why output SHAPE had to be added
 *
 * `NodeKindDefinition.outputs` is a `PortSpec` — port ids and labels, not data.
 * Nothing anywhere said "an llm_call emits `text`", so a context-aware list was
 * not derivable from the registry as it stood. `outputShape` is that missing
 * declaration, and it takes the node's config because the honest answer is
 * often config-dependent: a `user_input` step emits the field keys its author
 * defined, which no static list can know.
 */
beforeAll(() => {
  registerNodeKind({
    name: "@test/llm",
    label: "LLM",
    category: "action",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
    outputShape: [
      { path: "text", type: "string", description: "The model's reply." },
      { path: "tokens", type: "number" },
    ],
  } as never);

  registerNodeKind({
    name: "@test/form",
    label: "Form",
    category: "human",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
    // Config-derived: the keys only exist because an author typed them.
    outputShape: (config: { fields?: Array<{ key: string }> }) =>
      (config.fields ?? []).map((f) => ({ path: f.key, type: "string" as const })),
  } as never);

  registerNodeKind({
    name: "@test/sink",
    label: "Sink",
    category: "action",
    inputs: [{ id: "in" }],
    outputs: [{ id: "out" }],
  } as never);
});

function node(id: string, kind: string, config: Record<string, unknown> = {}) {
  return { id, type: kind, position: { x: 0, y: 0 }, data: { kind, label: id, config } } as never;
}

function graph(nodes: unknown[], edges: Array<[string, string]>): FlowGraph {
  return {
    nodes: nodes as never,
    edges: edges.map(([source, target], i) => ({ id: `e${i}`, source, target })) as never,
  };
}

describe("availableVariables", () => {
  it("offers the upstream node's declared output shape", () => {
    const g = graph([node("a", "@test/llm"), node("b", "@test/sink")], [["a", "b"]]);

    const vars = availableVariables(g, "b");
    const paths = vars.map((v) => v.expression);

    expect(paths).toContain("{{ $json.text }}");
    expect(paths).toContain("{{ $json.tokens }}");
    // The whole input is always offered — it is the one variable that exists
    // regardless of what upstream declared.
    expect(paths).toContain("{{ $json }}");
  });

  it("derives the shape from the upstream node's CONFIG when the kind is dynamic", () => {
    // The half a static list cannot do, and the one MOIC called out by name.
    const g = graph(
      [
        node("form", "@test/form", { fields: [{ key: "email" }, { key: "amount" }] }),
        node("b", "@test/sink"),
      ],
      [["form", "b"]],
    );

    const paths = availableVariables(g, "b").map((v) => v.expression);
    expect(paths).toContain("{{ $json.email }}");
    expect(paths).toContain("{{ $json.amount }}");
  });

  it("follows the edges, not the node list", () => {
    // An unconnected llm_call sitting on the canvas is NOT reachable, and
    // offering its fields would send the author down a path that resolves to
    // null at runtime.
    const g = graph(
      [node("a", "@test/llm"), node("orphan", "@test/llm"), node("b", "@test/sink")],
      [["a", "b"]],
    );

    const vars = availableVariables(g, "b");
    expect(vars.filter((v) => v.expression === "{{ $json.text }}")).toHaveLength(1);

    // And a node with no upstream gets only the always-available entries.
    const alone = availableVariables(g, "a").map((v) => v.expression);
    expect(alone).toEqual(["{{ $json }}"]);
  });

  it("unions multiple upstream nodes and de-duplicates", () => {
    const g = graph(
      [node("a", "@test/llm"), node("c", "@test/llm"), node("b", "@test/sink")],
      [["a", "b"], ["c", "b"]],
    );

    const paths = availableVariables(g, "b").map((v) => v.expression);
    expect(paths.filter((p) => p === "{{ $json.text }}")).toHaveLength(1);
  });

  it("does not walk past the immediate upstream node", () => {
    // `in` is the value on the wire, so only the DIRECT predecessor's output is
    // reachable. Offering a grandparent's fields would be a lie.
    const g = graph(
      [node("a", "@test/llm"), node("mid", "@test/sink"), node("b", "@test/sink")],
      [["a", "mid"], ["mid", "b"]],
    );

    expect(availableVariables(g, "b").map((v) => v.expression)).toEqual(["{{ $json }}"]);
  });

  it("survives a cycle", () => {
    const g = graph([node("a", "@test/llm"), node("b", "@test/sink")], [["a", "b"], ["b", "a"]]);
    expect(() => availableVariables(g, "b")).not.toThrow();
  });

  it("labels each variable with where it came from, preferring the AUTHOR's node label", () => {
    // The picker shows this: "text — from Summarize". The author's own label
    // beats the kind's generic one: a graph with three llm_call nodes is
    // unreadable if every variable says "LLM".
    const g = graph([node("a", "@test/llm"), node("b", "@test/sink")], [["a", "b"]]);
    g.nodes[0]!.data.label = "Summarize";

    const text = availableVariables(g, "b").find((v) => v.expression === "{{ $json.text }}");
    expect(text?.source).toBe("Summarize");
    expect(text?.description).toBe("The model's reply.");
  });

  it("falls back to the kind label when a node has none of its own", () => {
    const g = graph([node("a", "@test/llm"), node("b", "@test/sink")], [["a", "b"]]);
    delete (g.nodes[0]!.data as { label?: string }).label;

    const text = availableVariables(g, "b").find((v) => v.expression === "{{ $json.text }}");
    expect(text?.source).toBe("LLM");
  });
});

describe("describeExpressionGrammar", () => {
  it("documents the forms the PHP resolver actually implements", () => {
    const help = describeExpressionGrammar();
    const forms = help.forms.map((f) => f.syntax);

    expect(forms).toContain("{{ $json.field }}");
    expect(forms).toContain("{{ $json }}");
    // A guard against documenting a language nobody implemented: every form
    // shown MUST be a dot-path, because that is all `Expr::resolvePath` does.
    for (const f of help.forms) {
      expect(f.syntax).toMatch(/^\{\{ [$\w][\w.$]* \}\}$/);
    }
  });

  it("says where resolution actually happens", () => {
    // The thing an author most needs and would otherwise learn the hard way:
    // fancy-flow's own runFlow does not interpolate. Saying so is the
    // difference between help and a half-truth.
    expect(describeExpressionGrammar().note).toMatch(/executor|runtime/i);
  });
});

describe("the builtin kinds' declared output shapes", () => {
  /**
   * These are read off the fancy-flow-php executors that produce them, not
   * invented here. Offering a key the runtime never emits is worse than
   * offering nothing: the author writes `{{ $json.foo }}`, it resolves to null,
   * and the picker gave them every reason to trust it.
   *
   * Sources:
   *   llm_call     LlmClient::complete()  -> {text, usage?, raw?}
   *   api_request  HttpClient::send()     -> {status, headers, body}
   *   embed_search EmbedSearchExecutor    -> {query, matches}
   *   for_each     ForEachExecutor        -> {items, count}
   */
  // Read straight off BUILTIN_KINDS rather than the live registry: builtins
  // are registered by an explicit `registerBuiltinKinds()` call, so going
  // through the registry would make this pass or fail on registration order
  // rather than on what the kinds actually declare.
  it.each([
    ["@particle-academy/llm_call", ["text", "usage", "raw"]],
    ["@particle-academy/api_request", ["status", "headers", "body"]],
    ["@particle-academy/embed_search", ["query", "matches"]],
    ["@particle-academy/for_each", ["items", "count"]],
  ])("%s emits %j", async (kind, expected) => {
    const { BUILTIN_KINDS } = await import("../src/registry");
    const def = BUILTIN_KINDS.find((k) => k.name === kind) as { outputShape?: unknown } | undefined;
    expect(def, `no builtin kind ${kind}`).toBeTruthy();
    expect(Array.isArray(def!.outputShape)).toBe(true);
    expect((def!.outputShape as Array<{ path: string }>).map((f) => f.path)).toEqual(expected);
  });

  it("user_input derives its keys from the author's own fields", async () => {
    const { BUILTIN_KINDS } = await import("../src/registry");
    const shape = (BUILTIN_KINDS.find((k) => k.name === "@particle-academy/user_input") as {
      outputShape?: (c: unknown) => Array<{ path: string }>;
    })?.outputShape;

    expect(typeof shape).toBe("function");
    expect(
      shape!({ fields: [{ key: "email", label: "Email" }, { key: "amount" }] }).map((f) => f.path),
    ).toEqual(["email", "amount"]);

    // A half-typed row must not become a `{{ $json. }}` suggestion.
    expect(shape!({ fields: [{ label: "no key yet" }, { key: "" }] })).toEqual([]);
    expect(shape!({})).toEqual([]);
  });
});

describe("the expression regexes cannot be made to backtrack", () => {
  /**
   * CodeQL `js/polynomial-redos`, alerts #2 and #3 — introduced by 0.43.0 and
   * fixed in 0.43.1. Both were mine.
   *
   * The patterns were `\{\{\s*([\s\S]*?)\s*\}\}`. The `\s*` on either side of
   * the lazy capture is AMBIGUOUS with it: for a string that starts `{{` and
   * then runs on without a closing `}}`, the engine has to try every split
   * between "whitespace the \s* ate" and "whitespace the capture ate", which is
   * quadratic in the run length.
   *
   * The `\s*` was never load-bearing — `resolvePath` trims its argument, and
   * always did. Removing it is what fixes the ambiguity, and changes nothing:
   * the conformance table above still passes row for row.
   *
   * Reachability matters here rather than being theoretical. Config strings
   * arrive from workflow JSON that an agent or an API caller can author, so a
   * template is genuinely untrusted input on the way to `evaluateExpression`.
   */
  it.each([
    ["the exact CodeQL witness", "{{{{" + " ".repeat(60_000)],
    ["unterminated with tabs", "{{" + "\t".repeat(60_000)],
    ["many opens, never closed", "{{ ".repeat(20_000)],
    ["trailing whitespace run", "{{ a " + " ".repeat(60_000)],
    // CodeQL's SECOND witness, produced after the first fix. A global lazy scan
    // for a delimiter that never arrives is quadratic however the pattern is
    // written, which is why this is scanned with indexOf now rather than
    // matched.
    ["nested opens, never closed", "{{{{a".repeat(20_000)],
    ["one open then a huge body", "{{" + "a".repeat(200_000)],
  ])("stays fast on %s", async (_label, template) => {
    const { evaluateExpression } = await import("../src/expressions/expr");

    const started = Date.now();
    evaluateExpression(template, { in: {} });
    const elapsed = Date.now() - started;

    // The vulnerable pattern takes seconds-to-minutes on these; the fixed one
    // is single-digit milliseconds. 1s is a deliberately loose ceiling so a
    // slow CI box cannot make this flaky while still failing hard on a
    // reintroduced quadratic.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("still resolves a padded expression, which is what the \s* was for", async () => {
    const { evaluateExpression } = await import("../src/expressions/expr");
    expect(evaluateExpression("{{   $json.a   }}", { in: { a: 7 } })).toBe(7);
    expect(evaluateExpression("x {{\t$json.a\n}} y", { in: { a: 7 } })).toBe("x 7 y");
  });
});
