import type { ReactNode } from "react";
import type { NodeExecutor, PortDescriptor } from "../types";

/** Categories used by the palette for grouping. */
export type NodeCategory =
  | "trigger"
  | "logic"
  | "data"
  | "ai"
  | "io"
  | "human"
  | "output"
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
  | CredentialConfigField;

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
  /** Stable identifier — used as the xyflow node `type` and the schema export key. */
  name: string;
  /** Palette grouping. */
  category: NodeCategory;
  /** Display label. */
  label: string;
  /** One-line summary surfaced in the palette + agent bridge. */
  description?: string;
  /** Emoji or icon glyph rendered in the node header. */
  icon?: string;
  /** Hex / CSS color for the header bar. Falls back to a category default. */
  accent?: string;

  /** Declarative form schema for the config panel. */
  configSchema?: ConfigField[];
  /** Default config values used when a node of this kind is created. */
  defaultConfig?: TConfig;

  /** Input ports. Defaults vary by category. */
  inputs?: PortDescriptor[];
  /** Output ports. Defaults vary by category. */
  outputs?: PortDescriptor[];

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
};
