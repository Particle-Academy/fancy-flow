import type { ConfigField, NodeKindDefinition } from "./types";

const kinds = new Map<string, NodeKindDefinition<any, any, any>>();
const listeners = new Set<() => void>();

/**
 * registerNodeKind — install a node kind in the global registry. Returns
 * an `unregister` function. Calling with the same name replaces the prior
 * registration (handy for HMR).
 */
export function registerNodeKind<TC = any, TI = any, TO = any>(
  definition: NodeKindDefinition<TC, TI, TO>,
): () => void {
  kinds.set(definition.name, definition as NodeKindDefinition<any, any, any>);
  notify();
  return () => {
    if (kinds.get(definition.name) === (definition as any)) {
      kinds.delete(definition.name);
      notify();
    }
  };
}

/** Get a single kind by name, or null. */
export function getNodeKind(name: string): NodeKindDefinition | null {
  return (kinds.get(name) as NodeKindDefinition) ?? null;
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
    default:        return "#71717a";
  }
}
