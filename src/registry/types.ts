import type { ComponentType, ReactNode } from "react";
import type { NodeProps } from "@xyflow/react";
import type { FlowNode, NodeExecutor, PortDescriptor } from "../types";
import type { PauseAwaiting } from "./pause";

/** Categories used by the palette for grouping. */
export type NodeCategory =
  | "trigger"
  | "logic"
  | "data"
  | "ai"
  | "io"
  | "human"
  | "output"
  | "layout"
  | "annotation"
  | "custom";

/**
 * Tagged-union of config-field shapes the auto-form knows how to render.
 * Each variant has a `key` (the config object property it writes to) and
 * a `label`. Hosts can render fully custom panels via the kind's
 * `renderPanel` instead.
 */
export type ConfigField =
  | TextConfigField
  | TextareaConfigField
  | NumberConfigField
  | SelectConfigField
  | SwitchConfigField
  | JsonConfigField
  | ExpressionConfigField
  | CredentialConfigField
  | RepeaterConfigField
  | KeyValueConfigField
  | DocumentConfigField;

/**
 * Field types that may appear inside a `repeater` row. Excludes `repeater`
 * itself — a row of rows has no sane form rendering, and the nesting would
 * make the config shape hard for an agent to emit.
 */
export type RepeaterRowField = Exclude<ConfigField, RepeaterConfigField>;

type ConfigFieldBase = {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
};

export type TextConfigField = ConfigFieldBase & {
  type: "text";
  placeholder?: string;
  default?: string;
  /**
   * Optional fixed choices. When present the field renders as a select
   * instead of a free-text input — the same field declaration serves both a
   * free-form value and a constrained one, so a kind can gain choices later
   * without changing its `type` or migrating stored config.
   *
   * Bare strings are shorthand for `{ value, label: value }`.
   *
   * Unlike `type: "select"`, a stored value outside the list is preserved and
   * shown rather than rejected — choices can change after configs are saved,
   * and silently dropping an author's value is worse than showing a stale one.
   */
  choices?: Array<string | { value: string; label?: string }>;
};
export type TextareaConfigField = ConfigFieldBase & {
  type: "textarea";
  placeholder?: string;
  rows?: number;
  default?: string;
};
export type NumberConfigField = ConfigFieldBase & {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
  default?: number;
};
export type SelectConfigField = ConfigFieldBase & {
  type: "select";
  options: Array<{ value: string; label: string }>;
  default?: string;
};
export type SwitchConfigField = ConfigFieldBase & {
  type: "switch";
  default?: boolean;
};
export type JsonConfigField = ConfigFieldBase & {
  type: "json";
  language?: "json" | "yaml" | "javascript";
  rows?: number;
  default?: unknown;
};
export type ExpressionConfigField = ConfigFieldBase & {
  type: "expression";
  /** A short example string shown as placeholder, e.g. "{{ $json.name }}". */
  example?: string;
  default?: string;
};
export type CredentialConfigField = ConfigFieldBase & {
  type: "credential";
  /** Logical credential type. The host implements lookup / picker. */
  credentialType: string;
};

/**
 * Repeater — an editable list of objects, each row authored with its own
 * sub-schema of ConfigFields. This is what a node kind should reach for
 * instead of `type: "json"` whenever its config is list-shaped (form field
 * lists, router routes, tool bindings). Keeping it declarative is what lets
 * `NodeConfigPanel` stay the single authoring surface for humans AND keeps
 * the shape introspectable for agents.
 *
 * Value shape: `Array<Record<string, unknown>>`.
 */
export type RepeaterConfigField = ConfigFieldBase & {
  type: "repeater";
  /** Schema applied to every row. */
  fields: RepeaterRowField[];
  /**
   * Row field whose value titles the row in the editor. Falls back to the
   * first field's value, then to "Item N".
   */
  titleKey?: string;
  /** Label for the add button. Default: "Add". */
  addLabel?: string;
  /** Bounds enforced by validation + the add/remove controls. */
  minItems?: number;
  maxItems?: number;
  default?: Array<Record<string, unknown>>;
};

/**
 * Key/value map — an editable `Record<string, string>`. Use for filter maps,
 * input bindings, header maps, and case→port tables.
 *
 * Value shape: `Record<string, string>`.
 */
export type KeyValueConfigField = ConfigFieldBase & {
  type: "keyvalue";
  keyLabel?: string;
  valueLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Constrain values to a fixed set (e.g. the node's own port ids). */
  valueOptions?: Array<{ value: string; label: string }>;
  addLabel?: string;
  default?: Record<string, string>;
};

/**
 * Document — an opaque rich/structured document stored in node config and
 * edited by a HOST-SUPPLIED editor, wired through
 * `NodeConfigPanel`'s `renderDocumentField`.
 *
 * fancy-flow deliberately does not know what a document *is* — same
 * arrangement as `credential`. That keeps rich human-input surfaces (authored
 * pages, required-reading steps, multi-section forms) possible without the
 * editor taking a dependency on any particular document model or CMS.
 */
export type DocumentConfigField = ConfigFieldBase & {
  type: "document";
  /**
   * Logical document format, passed through to the host renderer so one host
   * can serve several (e.g. "stages", "markdown", "portable-text").
   */
  documentType?: string;
  default?: unknown;
};

/**
 * Port declaration — either a fixed list, or a function of the node's config
 * for kinds whose branches ARE their config (switch cases, router routes).
 *
 * Declaring the function form keeps the canvas ports, the config, and the
 * ports the runtime activates in lockstep automatically; a static list forces
 * every consumer to hand-sync `data.outputs` from config in a custom renderer,
 * and forgetting to breaks routing silently at execution time.
 */
export type PortSpec<TConfig = unknown> =
  | PortDescriptor[]
  | ((config: TConfig) => PortDescriptor[]);

/**
 * Context passed to a kind's optional `renderBody`. Hosts can read the
 * resolved config + node id to render whatever fancy-* component they
 * want inside the node card.
 */
export type RenderBodyContext<TConfig = unknown> = {
  nodeId: string;
  config: TConfig;
  selected: boolean;
};

/**
 * NodeKindDefinition — declares an authorable node type. Register one
 * via `registerNodeKind()`. Hosts (and the agent bridge) introspect the
 * registry to know what's authorable.
 */
export type NodeKindDefinition<TConfig = Record<string, unknown>, TIn = any, TOut = any> = {
  /**
   * Canonical identifier — the xyflow node `type` and the value persisted as
   * `kind` in every saved document.
   *
   * Namespace it when publishing (`@fancy/llm_branch`,
   * `@acme/salesforce_upsert`). A bare name that two packages could both claim
   * makes stored graphs ambiguous, and that is unfixable afterwards because the
   * ambiguous string is already written into the document.
   */
  name: string;
  /**
   * Other ids this kind answers to — previous bare names, or a short alias.
   * Resolution accepts them, but export always writes `name`, so documents
   * converge on the canonical id as they are re-saved.
   */
  aliases?: string[];
  /** Palette grouping. */
  category: NodeCategory;
  /** Display label. */
  label: string;
  /** One-line summary surfaced in the palette + agent bridge. */
  description?: string;
  /**
   * Icon rendered in the node header and the palette row. A glyph string is
   * fine; any ReactNode works, so a brand SVG can be dropped in directly.
   */
  icon?: ReactNode;
  /** Hex / CSS color for the header bar. Falls back to a category default. */
  accent?: string;

  /** Declarative form schema for the config panel. */
  configSchema?: ConfigField[];
  /** Default config values used when a node of this kind is created. */
  defaultConfig?: TConfig;

  /** Input ports. Defaults vary by category. See `PortSpec`. */
  inputs?: PortSpec<TConfig>;
  /** Output ports. Defaults vary by category. See `PortSpec`. */
  outputs?: PortSpec<TConfig>;

  /** Optional custom body rendered inside the node card. */
  renderBody?: (ctx: RenderBodyContext<TConfig>) => ReactNode;

  /**
   * Optional override for the config panel. Receives the current config and
   * an onChange to update it. Defaults to the auto-generated form.
   */
  renderPanel?: (props: {
    config: TConfig;
    onChange: (next: TConfig) => void;
    nodeId: string;
  }) => ReactNode;

  /**
   * Executor — host-implemented function that runs at flow execution.
   * Optional: built-in agentic kinds ship without one so the host wires
   * the actual work (memory store backend, LLM client, HTTP fetcher, etc.).
   */
  executor?: NodeExecutor<TIn, TOut>;

  /**
   * Declares that this kind halts the run to wait for a person, and what for.
   *
   * Only a declaration — the executor still emits the pause (via
   * `pauseForHuman`). Its value is that it is readable WITHOUT running the
   * graph: a host can be told "this workflow needs a resume path you haven't
   * built" before the first run parks itself forever, and the marketplace can
   * refuse to list a pausing node whose package never says so.
   */
  pausesForHuman?: PauseAwaiting;

  /**
   * Make nodes of this kind resizable via drag handles (xyflow NodeResizer).
   * `true` enables it with defaults; pass options to bound it. The resulting
   * width/height are written onto the node and persisted by the schema (0.21+).
   */
  resizable?:
    | boolean
    | { minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number; keepAspectRatio?: boolean };

  /**
   * Contextual per-node toolbar (xyflow NodeToolbar), shown while the node is
   * selected — a discoverable, agent-legible alternative to the right-click
   * menu. Call `useFlowEditor()` inside it to reach the editor api.
   */
  toolbar?: (ctx: { nodeId: string; config: TConfig; selected: boolean }) => ReactNode;

  /**
   * Full custom node renderer. When set, `buildNodeTypes` uses this component
   * for the kind INSTEAD of the default `RegistryNode` card — the escape hatch
   * for nodes that aren't cards (lanes / containers / groups). Receives
   * xyflow's `NodeProps`.
   */
  component?: ComponentType<NodeProps<FlowNode>>;

  /**
   * Opt this kind into reactive data flow: during a run, a node's computed
   * output is written back into its `data.output`, so its card reflects the
   * value live ("computing flows"). Default off — non-reactive kinds are
   * untouched, so this is purely additive.
   */
  reactive?: boolean;
};
