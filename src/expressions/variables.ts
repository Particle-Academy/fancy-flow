import { getNodeKind } from "../registry/registry";
import type { FlowGraph, FlowNode } from "../types";

/**
 * What a node emits, described well enough for an author to reference it.
 *
 * This is deliberately NOT `outputs` — that is a `PortSpec`, which describes
 * WIRES (port ids and labels). Nothing in the registry described the DATA on
 * those wires, so "what can I write in this field" had no answer to derive
 * from. Hence a second, small declaration.
 */
export type OutputField = {
  /** Dot-path relative to the emitted value: `text`, `user.email`. */
  path: string;
  type?: "string" | "number" | "boolean" | "object" | "array" | "unknown";
  description?: string;
};

/**
 * A kind's output shape — static, or computed from the node's config.
 *
 * The function form is the important one. A `user_input` step emits exactly the
 * field keys its author defined, and a `transform` emits the keys it was told
 * to build; no static list can know either. A static list would have forced
 * every dynamic kind to declare nothing, which is the case an author most needs
 * help with.
 */
export type OutputShape<TConfig = Record<string, unknown>> =
  | OutputField[]
  | ((config: TConfig) => OutputField[]);

/** One entry in the variable picker. */
export type AvailableVariable = {
  /** Exactly what gets inserted, including the braces. */
  expression: string;
  /** The bare path, for display: `$json.text`. */
  path: string;
  type?: OutputField["type"];
  description?: string;
  /** Label of the upstream node this came from, for disambiguation. */
  source?: string;
};

/**
 * `$json` and `$input` both alias the `in` port value in the PHP resolver
 * (`Expr::resolvePath`). We suggest ONE of them so the picker does not present
 * the same variable twice under two names; `$json` is the spelling every
 * builtin kind's `example` already uses.
 */
const ROOT = "$json";

function expr(path: string): string {
  return `{{ ${path} }}`;
}

/** Resolve a kind's output shape for a specific node. */
export function outputFieldsFor(node: FlowNode): OutputField[] {
  const kindName = (node.data as { kind?: string } | undefined)?.kind ?? node.type;
  if (!kindName) return [];

  const kind = getNodeKind(kindName) as { outputShape?: OutputShape } | undefined;
  const shape = kind?.outputShape;
  if (!shape) return [];

  if (typeof shape === "function") {
    // A kind computes this from author-supplied config, which is exactly where
    // a throw would be easiest to write and worst to ship — a malformed config
    // would take the whole panel down rather than showing one short list.
    try {
      const config = (node.data as { config?: Record<string, unknown> } | undefined)?.config ?? {};
      return shape(config) ?? [];
    } catch {
      return [];
    }
  }
  return shape;
}

/**
 * The variables an author can reference from `nodeId`, in this graph.
 *
 * Only the DIRECT predecessors are consulted, because `in` is the value on the
 * incoming wire. Walking further would offer a grandparent's fields, which
 * resolve to `null` at runtime — a suggestion that silently produces nothing is
 * worse than no suggestion, since the author has no reason to doubt it.
 *
 * Always includes the whole input. That one exists no matter what upstream
 * declared, and it is the escape hatch when a kind has no `outputShape` yet.
 */
export function baseVariables(): AvailableVariable[] {
  return [
    { expression: expr(ROOT), path: ROOT, type: "unknown", description: "The whole incoming value." },
  ];
}

export function availableVariables(graph: FlowGraph, nodeId: string): AvailableVariable[] {
  const out: AvailableVariable[] = baseVariables();
  const seen = new Set<string>([ROOT]);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const upstreamIds = graph.edges.filter((e) => e.target === nodeId).map((e) => e.source);

  for (const id of upstreamIds) {
    if (id === nodeId) continue; // a self-edge is not an input shape
    const upstream = byId.get(id);
    if (!upstream) continue;

    const kindName = (upstream.data as { kind?: string } | undefined)?.kind ?? upstream.type;
    const label =
      (upstream.data as { label?: string } | undefined)?.label ??
      (kindName ? getNodeKind(kindName)?.label : undefined);

    for (const field of outputFieldsFor(upstream)) {
      const path = `${ROOT}.${field.path}`;
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({
        expression: expr(path),
        path,
        type: field.type,
        description: field.description,
        source: label,
      });
    }
  }

  return out;
}

/** One documented form of the expression grammar. */
export type ExpressionForm = { syntax: string; meaning: string };

export type ExpressionGrammarHelp = {
  forms: ExpressionForm[];
  note: string;
};

/**
 * The reference help shown beside an expression field.
 *
 * Every form here is one `Expr::resolvePath` implements — a dot-path and
 * nothing else. It is tempting to document `{{ a && b }}` or `{{ a + b }}`
 * because they look like expressions; the resolver would return `null` for
 * both, and an author following the help would have no way to tell why.
 */
export function describeExpressionGrammar(): ExpressionGrammarHelp {
  return {
    forms: [
      { syntax: "{{ $json }}", meaning: "The whole value arriving on this node's input." },
      { syntax: "{{ $json.field }}", meaning: "One key of that value. Dot-paths nest: $json.user.email." },
      { syntax: "{{ $input.field }}", meaning: "An alias for $json — the same value, either spelling." },
      { syntax: "{{ in }}", meaning: "The input by its context key, rather than through the alias." },
    ],
    note:
      "Dot-paths only — no arithmetic, comparisons or function calls; anything else resolves to nothing. " +
      "A field that is exactly one expression keeps the resolved value's type; mixed text interpolates as a string. " +
      "fancy-flow's own runFlow does not interpolate: it hands config to your executor verbatim, and the " +
      "fancy-flow-php runtime is what resolves these.",
  };
}
