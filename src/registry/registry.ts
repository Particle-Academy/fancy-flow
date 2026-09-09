import type { ConfigField, NodeCategory, NodeKindDefinition } from "./types";
// The DATA module, deliberately -- importing `./builtin` here is what put
// React into `/engine` (#11). See that file for the whole story.
import { registerBuiltinKindData } from "./builtin-kinds";

const kinds = new Map<string, NodeKindDefinition<any, any, any>>();
/** alias → canonical name. See `resolveKindId`. */
const aliases = new Map<string, string>();
const listeners = new Set<() => void>();
/**
 * canonical name → presentation patch. See `overrideNodeKind`.
 *
 * Kept SEPARATE from `kinds` on purpose: an override has to survive its base
 * kind being re-registered (HMR, a later `registerBuiltinKinds()`, a package
 * upgrade). Merging into the definition would mean the next registration
 * silently reverts the consumer's naming.
 */
const overrides = new Map<string, NodeKindPresentation>();

/**
 * Names a HOST registered, as opposed to names the builtin kit registered.
 *
 * Builtin registration is not a one-shot event: `registerBuiltinKinds()` is
 * exported, the four kinds with renderers are deliberately registered twice
 * (React-free table, then decorated), and since 0.66.1 the root barrel calls it
 * as an import side effect. So "the builtins register again" happens routinely
 * and at times no consumer can predict.
 *
 * Without this set, every one of those occasions silently reverted a host's
 * replacement of a builtin — the only mechanism we offer for extending one.
 * A consumer's field would vanish from the editor while their server kept
 * validating it, and whether it happened at all depended on which module their
 * bundler evaluated second.
 *
 * This is the same protection `overrides` already had, and for the same stated
 * reason. Presentation patches were kept safe from re-registration; behavioural
 * replacement was not, and nothing marked the asymmetry.
 */
const hostOwned = new Set<string>();

/**
 * canonical name -> schema patch from a SERVER. See `applyKindSchemaOverlay`.
 *
 * Kept in its own map for the reason `overrides` is: a patch stored ON the kind
 * is reverted the next time that kind is registered, and builtin registration
 * is not a one-shot event. 0.66.2 was exactly that bug for behavioural
 * replacement; this is the same shape and gets the same protection rather than
 * waiting to learn it twice.
 */
const schemaOverlays = new Map<string, KindSchemaOverlay>();

/**
 * The builtin definition for a name, kept even while a host owns the name.
 *
 * Without it, releasing a claim could only DELETE the entry — which is a worse
 * state than before the override, not a return to it: the palette loses the
 * node and the canvas renders raw kind ids where a label belongs.
 */
const builtinDefs = new Map<string, NodeKindDefinition<any, any, any>>();

let builtinsEnsured = false;

/**
 * Put the builtin kit in the registry before anyone reads or writes it.
 *
 * Registration used to be a bare `registerBuiltinKinds()` in `src/index.ts`, so
 * it fired ONLY as an import side effect of that one entry. Every other route in
 * — the `/engine` and `/registry` subpaths, or a root import that TypeScript
 * erases because it only took types — got an empty registry, and an empty
 * registry is silent: `getNodeKind()` returns null, `FlowViewer` falls through
 * its title chain, and the canvas shows `@particle-academy/llm_call` where a
 * name belongs.
 *
 * Doing it here instead means correctness no longer depends on which entry a
 * consumer imported, or on a bundler agreeing to keep a top-level statement.
 *
 * The flag is set BEFORE the call so a listener that reads the registry from
 * inside `notify()` cannot recurse. `registerNodeKind` ensures too, so builtins
 * are always in place before a host registers over one of them.
 */
export function ensureBuiltinKinds(): void {
  if (builtinsEnsured) return;
  builtinsEnsured = true;
  registerBuiltinKindData();
}

/**
 * The presentation fields a consumer may override on someone else's node kind.
 *
 * Deliberately excludes everything behavioural — `executor`, `inputs`,
 * `outputs`, `configSchema`, `sideEffects`. An "override" that could change
 * those is not an override, it is a fork wearing a friendly name, and it would
 * desync the graph from the runtime that executes it.
 *
 * `category` IS included: which drawer a node appears in is presentation, and a
 * consumer regrouping their palette is the same kind of act as renaming.
 */
export type NodeKindPresentation = Partial<
  Pick<NodeKindDefinition, "label" | "description" | "icon" | "accent" | "category">
>;

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
  ensureBuiltinKinds();
  // Claiming the name is what protects it: from here on the builtin kit will
  // not overwrite this entry, however many times it re-registers.
  hostOwned.add(definition.name);
  kinds.set(definition.name, definition as NodeKindDefinition<any, any, any>);
  for (const alias of definition.aliases ?? []) aliases.set(alias, definition.name);
  notify();
  return () => {
    if (kinds.get(definition.name) === (definition as any)) {
      kinds.delete(definition.name);
      hostOwned.delete(definition.name);
      for (const alias of definition.aliases ?? []) {
        if (aliases.get(alias) === definition.name) aliases.delete(alias);
      }
      notify();
    }
  };
}

/**
 * Register a kind AS PART OF THE BUILTIN KIT — never overwriting a host.
 *
 * The builtin modules use this instead of `registerNodeKind` so that repeated
 * builtin registration is safe. It still replaces builtins (the four kinds with
 * renderers are registered twice on purpose, plain table then decorated), but
 * it steps aside for any name a host has claimed.
 *
 * Internal: not re-exported from the package. A consumer wanting to install a
 * kind uses `registerNodeKind`, and gets ownership of the name by doing so.
 */
export function registerBuiltinKindInternal(
  definition: NodeKindDefinition<any, any, any>,
): void {
  // Recorded BEFORE the ownership check: a host owning the name now is exactly
  // when we will later need the builtin to hand back.
  builtinDefs.set(definition.name, definition);

  if (hostOwned.has(definition.name)) return;

  kinds.set(definition.name, definition);
  for (const alias of definition.aliases ?? []) {
    if (!hostOwned.has(aliases.get(alias) ?? "")) aliases.set(alias, definition.name);
  }
}

/**
 * Release a host's claim on a name and restore the builtin behind it.
 *
 * The counterpart to `registerNodeKind` replacing a builtin. `registerNodeKind`
 * does return an unregister closure, but a consumer reading the export list
 * cannot find it, and one correctly concluded no such operation existed — so
 * this is the named form.
 *
 * **Test isolation is the reason it matters.** Before 0.66.2, calling
 * `registerBuiltinKinds()` restored the builtins over any override, and people
 * reasonably used that to reset between tests. Since 0.66.2 it correctly
 * refuses to overwrite a host's registration, so that reset silently stopped
 * resetting — and it does not fail where it broke, it fails as a wrong
 * assertion in a later, unrelated test. Use this instead.
 *
 * Returns whether anything was actually released, so a typo'd name is visible
 * rather than a silent no-op — a reset helper that quietly stops resetting is
 * the failure this exists to prevent.
 */
export function unregisterNodeKind(name: string): boolean {
  const canonical = resolveKindId(name) ?? name;

  const released = hostOwned.delete(canonical);
  if (!released && !kinds.has(canonical)) return false;

  const builtin = builtinDefs.get(canonical);
  if (builtin) {
    kinds.set(canonical, builtin);
    for (const alias of builtin.aliases ?? []) aliases.set(alias, canonical);
  } else {
    const previous = kinds.get(canonical);
    kinds.delete(canonical);
    for (const alias of previous?.aliases ?? []) {
      if (aliases.get(alias) === canonical) aliases.delete(alias);
    }
  }

  notify();

  return released;
}

/**
 * Empty the registry completely, builtins included.
 *
 * For tests that need a clean slate — in particular any test asserting how host
 * and builtin registration interact, which cannot be written against a registry
 * still holding the previous test's kinds. Production code has no reason to
 * call it: a registry that can be emptied at runtime is a registry that can be
 * emptied at the wrong moment.
 */
export function resetNodeKindsForTests(): void {
  kinds.clear();
  aliases.clear();
  overrides.clear();
  schemaOverlays.clear();
  hostOwned.clear();
  builtinDefs.clear();
  builtinsEnsured = false;
  notify();
}

/**
 * A schema patch for a kind, sourced from a host's SERVER-side registry.
 *
 * fancy-flow has two kind registries. The PHP one lets a host decorate a
 * builtin and that decoration reaches the runtime and validation; the editor,
 * built from the JS registry, never learned any of it. A consumer hit this as a
 * field that existed, ran, and had no control in the panel.
 *
 * **The server owns what a node is CONFIGURED with. The client keeps what a
 * node DOES.** Only the serialisable half is here on purpose: `executor`,
 * `component`, `renderBody` and `icon` cannot cross a wire, and neither can
 * ports — `PortSpec` may be a FUNCTION of config, and three builtins use that
 * form (`switch_case` groups match keys onto one port and joins their labels;
 * `subflow` branches on a derived mode and cares about order). Expressing those
 * as data needs a mini-language with grouping, conditionals and ordering, which
 * is a second implementation of logic that already exists.
 */
export type KindSchemaOverlay = {
  /** Canonical id or alias — resolved either way. */
  kind: string;
  /**
   * REPLACES the kind's schema. Never merges.
   *
   * The motivating case is *drop seven fields and add one*, and a merge cannot
   * express a removal. A `remove: string[]` beside a merge would be two
   * mechanisms for one job, and their interaction would be the next bug. The
   * server sends the schema it wants; that is the point of it owning one.
   */
  configSchema?: ConfigField[];
  label?: string;
  description?: string;
  category?: NodeCategory;
};

export type KindSchemaOverlayResult = {
  /** Canonical ids that matched a registered kind. */
  applied: string[];
  /**
   * Ids that matched NOTHING, reported rather than dropped.
   *
   * A server lists many kinds and a client will not have registered all of
   * them. Applying what matches and staying quiet about the rest is how a
   * field goes missing with no error anywhere — which is the defect this whole
   * mechanism exists to end, so it must not be reintroduced by the fix.
   */
  unknown: string[];
  unapply: () => void;
};

/**
 * Apply server-sourced schema patches to kinds this client already has.
 *
 * It does NOT register kinds. A kind must exist locally for its executor,
 * ports and renderer; the overlay corrects its schema, it does not conjure one.
 */
export function applyKindSchemaOverlay(
  overlays: readonly KindSchemaOverlay[],
): KindSchemaOverlayResult {
  ensureBuiltinKinds();

  const applied: string[] = [];
  const unknown: string[] = [];
  const previous = new Map<string, KindSchemaOverlay | undefined>();

  for (const overlay of overlays) {
    const canonical = resolveKindId(overlay.kind);
    if (!canonical) {
      unknown.push(overlay.kind);
      continue;
    }

    if (!previous.has(canonical)) previous.set(canonical, schemaOverlays.get(canonical));
    schemaOverlays.set(canonical, { ...overlay, kind: canonical });
    applied.push(canonical);
  }

  if (applied.length > 0) notify();

  return {
    applied,
    unknown,
    unapply: () => {
      for (const [canonical, before] of previous) {
        if (before) {
          schemaOverlays.set(canonical, before);
        } else {
          schemaOverlays.delete(canonical);
        }
      }
      notify();
    },
  };
}

/** Drop every server-sourced schema patch. Mostly for tests. */
export function clearKindSchemaOverlays(): void {
  if (schemaOverlays.size === 0) return;
  schemaOverlays.clear();
  notify();
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
  ensureBuiltinKinds();
  if (kinds.has(id)) return id;
  const canonical = aliases.get(id);
  return canonical && kinds.has(canonical) ? canonical : null;
}

/**
 * Rename or re-describe a kind you did not author.
 *
 * Before this existed the only way to relabel a builtin was `registerNodeKind`
 * with a full definition — which REPLACES the kind, so a consumer wanting
 * "Call an API" instead of "HTTP Request" had to re-declare that node's
 * configSchema, ports, executor and renderer, and silently forfeited whatever
 * the builtin gained in the next release. In practice nobody renamed a node,
 * and the palette could not be localised at all.
 *
 * ```ts
 * const undo = overrideNodeKind("@particle-academy/api_request", {
 *   label: "Call an API",
 *   description: "Fetch or post JSON to a URL",
 * });
 * ```
 *
 * Applies at `getNodeKind()` and `listNodeKinds()`, so one call reaches the
 * palette, the node cards on the canvas, `FlowViewer`, and anything else that
 * reads the registry. Returns an unsubscribe, matching `registerNodeKind`.
 *
 * Patching an unregistered id is allowed and takes effect if that kind is
 * registered later — order of module side effects is not something a consumer
 * should have to reason about.
 */
export function overrideNodeKind(name: string, patch: NodeKindPresentation): () => void {
  const canonical = resolveKindId(name) ?? name;
  const previous = overrides.get(canonical);

  overrides.set(canonical, { ...previous, ...patch });
  notify();

  return () => {
    if (previous) {
      overrides.set(canonical, previous);
    } else {
      overrides.delete(canonical);
    }
    notify();
  };
}

/** Remove every presentation override. Mostly for tests. */
export function clearNodeKindOverrides(): void {
  if (overrides.size === 0) return;
  overrides.clear();
  notify();
}

function withOverride(kind: NodeKindDefinition | undefined): NodeKindDefinition | null {
  if (!kind) return null;

  // base -> SERVER schema -> LOCAL presentation override.
  //
  // The local override wins, and the order is pinned by a test because it is
  // invisible until the two disagree: `overrideNodeKind` is the app author's
  // explicit choice about naming, which is more specific than a server default.
  const overlay = schemaOverlays.get(kind.name);
  const patch = overrides.get(kind.name);
  if (!overlay && !patch) return kind;

  const withSchema = overlay
    ? ({
        ...kind,
        ...(overlay.configSchema !== undefined ? { configSchema: overlay.configSchema } : {}),
        ...(overlay.label !== undefined ? { label: overlay.label } : {}),
        ...(overlay.description !== undefined ? { description: overlay.description } : {}),
        ...(overlay.category !== undefined ? { category: overlay.category } : {}),
      } as NodeKindDefinition)
    : kind;

  return patch ? ({ ...withSchema, ...patch } as NodeKindDefinition) : withSchema;
}

/** Get a single kind by canonical id or alias, or null. */
export function getNodeKind(name: string): NodeKindDefinition | null {
  const canonical = resolveKindId(name);
  return canonical ? withOverride(kinds.get(canonical) as NodeKindDefinition) : null;
}

/** Every id a kind answers to — canonical first. Used to key node-type maps. */
export function kindIds(kind: NodeKindDefinition): string[] {
  return [kind.name, ...(kind.aliases ?? [])];
}

/** List every registered kind, optionally filtered by category. */
export function listNodeKinds(category?: string): NodeKindDefinition[] {
  ensureBuiltinKinds();
  const all = Array.from(kinds.values()).map((k) =>
    withOverride(k as NodeKindDefinition),
  ) as NodeKindDefinition[];
  // Filter AFTER applying overrides, so an override that moves a node to a
  // different category actually moves it in the palette rather than leaving it
  // filed under the old one with a new name.
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
    case "annotation": return "#eab308";
    default:        return "#71717a";
  }
}
