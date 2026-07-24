import type { ConfigField, NodeKindDefinition } from "./types";

const kinds = new Map<string, NodeKindDefinition<any, any, any>>();
/** alias → canonical name. See `resolveKindId`. */
const aliases = new Map<string, string>();
const listeners = new Set<() => void>();

/**
 * registerNodeKind — install a node kind in the global registry. Returns
 * an `unregister` function. Calling with the same name replaces the prior
 * registration (handy for HMR).
 *
 * A kind's `name` is its CANONICAL id and is what gets written into saved
 * documents. Publish namespaced (`@fancy/llm_branch`, `@acme/salesforce_upsert`)
 * and list any previous bare names in `aliases`, so graphs saved before the
 * rename keep resolving.
 */
export function registerNodeKind<TC = any, TI = any, TO = any>(
  definition: NodeKindDefinition<TC, TI, TO>,
): () => void {
  kinds.set(definition.name, definition as NodeKindDefinition<any, any, any>);
  for (const alias of definition.aliases ?? []) aliases.set(alias, definition.name);
  notify();
  return () => {
    if (kinds.get(definition.name) === (definition as any)) {
      kinds.delete(definition.name);
      for (const alias of definition.aliases ?? []) {
        if (aliases.get(alias) === definition.name) aliases.delete(alias);
      }
      notify();
    }
  };
}

/**
 * Resolve any id — canonical or alias — to the canonical one, or null.
 *
 * `kind` is persisted inside every saved graph, so a bare name that two
 * packages could both claim is unfixable after the fact: the ambiguous string
 * is already in the document. Canonical ids are namespaced; aliases exist so
 * documents written before namespacing keep opening.
 */
export function resolveKindId(id: string): string | null {
  if (kinds.has(id)) return id;
  const canonical = aliases.get(id);
  return canonical && kinds.has(canonical) ? canonical : null;
}

/** Get a single kind by canonical id or alias, or null. */
export function getNodeKind(name: string): NodeKindDefinition | null {
  const canonical = resolveKindId(name);
  return canonical ? ((kinds.get(canonical) as NodeKindDefinition) ?? null) : null;
}

/** Every id a kind answers to — canonical first. Used to key node-type maps. */
export function kindIds(kind: NodeKindDefinition): string[] {
  return [kind.name, ...(kind.aliases ?? [])];
}

/** List every registered kind, optionally filtered by category. */
export function listNodeKinds(category?: string): NodeKindDefinition[] {
  const all = Array.from(kinds.values()) as NodeKindDefinition[];
  return category ? all.filter((k) => k.category === category) : all;
}

/** Subscribe to registry changes. Returns an unsubscribe function. */
export function onNodeKindsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

/** Fill in defaults from a kind's configSchema for newly-created nodes. */
export function defaultConfigFor(kind: NodeKindDefinition): Record<string, unknown> {
  const fromKind = kind.defaultConfig ? { ...(kind.defaultConfig as Record<string, unknown>) } : {};
  for (const field of kind.configSchema ?? []) {
    if (fromKind[field.key] !== undefined) continue;
    if ("default" in field && (field as any).default !== undefined) {
      fromKind[field.key] = (field as any).default;
    }
  }
  return fromKind;
}

/**
 * Validate a config object against a kind's schema. Returns an array of
 * issues (empty = valid). Validation is intentionally light — type
 * coercion + required-field checks. Hosts can layer Zod / Ajv on top.
 */
export function validateConfig(
  kind: NodeKindDefinition,
  config: Record<string, unknown>,
): Array<{ key: string; message: string }> {
  const issues: Array<{ key: string; message: string }> = [];
  for (const field of kind.configSchema ?? []) {
    const value = config[field.key];
    if (field.required && (value === undefined || value === null || value === "")) {
      issues.push({ key: field.key, message: `${field.label} is required` });
      continue;
    }
    if (value === undefined || value === null) continue;
    const issue = validateField(field, value);
    if (issue) issues.push({ key: field.key, message: issue });
  }
  return issues;
}

function validateField(field: ConfigField, value: unknown): string | null {
  switch (field.type) {
    case "text":
    case "textarea":
    case "expression":
    case "credential":
      return typeof value === "string" ? null : `${field.label} must be a string`;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${field.label} must be a number`;
      if (field.min !== undefined && value < field.min) return `${field.label} must be >= ${field.min}`;
      if (field.max !== undefined && value > field.max) return `${field.label} must be <= ${field.max}`;
      return null;
    }
    case "switch":
      return typeof value === "boolean" ? null : `${field.label} must be a boolean`;
    case "select": {
      const allowed = field.options.map((o) => o.value);
      return allowed.includes(String(value)) ? null : `${field.label} must be one of ${allowed.join(", ")}`;
    }
    case "json":
      return null; // permissive — just JSON-shaped
    case "repeater": {
      if (!Array.isArray(value)) return `${field.label} must be a list`;
      if (field.minItems !== undefined && value.length < field.minItems) {
        return `${field.label} needs at least ${field.minItems}`;
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        return `${field.label} allows at most ${field.maxItems}`;
      }
      // Surface the first offending row so the author knows WHICH one.
      for (let i = 0; i < value.length; i++) {
        const row = value[i];
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          return `${field.label} item ${i + 1} must be an object`;
        }
        for (const sub of field.fields) {
          const cell = (row as Record<string, unknown>)[sub.key];
          if (sub.required && (cell === undefined || cell === null || cell === "")) {
            return `${field.label} item ${i + 1}: ${sub.label} is required`;
          }
          if (cell === undefined || cell === null) continue;
          const issue = validateField(sub, cell);
          if (issue) return `${field.label} item ${i + 1}: ${issue}`;
        }
      }
      return null;
    }
    case "keyvalue": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return `${field.label} must be a key/value map`;
      }
      const allowed = field.valueOptions?.map((o) => o.value);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v !== "string") return `${field.label}: "${k}" must be a string`;
        if (allowed && !allowed.includes(v)) {
          return `${field.label}: "${k}" must be one of ${allowed.join(", ")}`;
        }
      }
      return null;
    }
    case "document":
      return null; // opaque to fancy-flow — the host's editor owns its shape
    default:
      return null;
  }
}

/** Default accents per category. */
export function categoryAccent(category: string): string {
  switch (category) {
    case "trigger": return "#10b981";
    case "logic":   return "#f59e0b";
    case "data":    return "#0ea5e9";
    case "ai":      return "#8b5cf6";
    case "io":      return "#3b82f6";
    case "human":   return "#ec4899";
    case "output":  return "#a855f7";
    case "layout":  return "#64748b";
    default:        return "#71717a";
  }
}
