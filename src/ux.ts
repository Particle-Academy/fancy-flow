/**
 * FlowRunnerUx — the **flow-driven UX** bridge. The headless counterpart to
 * agent-integrations: where that wires an *agent* to host UI surfaces, this
 * wires a *running flow* to host UX. Both share the same primitives from
 * `@particle-academy/fancy-auto-common` (activity bus, effect dispatch).
 *
 * The host registers named UX effects (toast, navigate, confirm, …); this turns
 * each into a flow executor keyed by a node kind (`ux_<effect>` by default), so
 * dropping a `ux_toast` node into a `<FlowEditor>` and running it fires the
 * host's toast. Every dispatch broadcasts an `AutoActivityEvent` (source:"flow")
 * for presence / logging. Human-in-the-loop is free: an effect that returns a
 * Promise (e.g. an approval dialog) pauses the run until the user resolves it.
 *
 *   const ux = createFlowRunnerUx({
 *     effects: {
 *       toast:   ({ message }) => toast({ title: message }),
 *       navigate:({ to })      => router.visit(to),
 *       confirm: ({ prompt })  => new Promise(res => openDialog(prompt, res)), // pauses the run
 *     },
 *   });
 *   ux.registerKinds();                       // adds ux_toast / ux_navigate / ux_confirm to the palette
 *   <FlowEditor initial={graph} executors={ux.executors} />
 */
import { useMemo } from "react";
import {
  createEffectDispatcher,
  type DispatchActor,
  type EffectRegistry,
} from "@particle-academy/fancy-auto-common";
import { registerNodeKind } from "./registry/registry";
import type { ConfigField, NodeCategory } from "./registry/types";
import type { ExecutorRegistry, FlowNode } from "./types";

export type { AutoActivityEvent } from "@particle-academy/fancy-auto-common";

/** Per-effect presentation for the palette node kind that drives it. */
export type UxEffectMeta = {
  /** Palette label. Default: the effect name. */
  label?: string;
  /** One-line palette description. */
  description?: string;
  /** Emoji / glyph for the node header. */
  icon?: string;
  /** Header accent color. */
  accent?: string;
  /** Palette grouping. Default "output". */
  category?: NodeCategory;
  /** Config form fields = the effect's params. */
  configSchema?: ConfigField[];
};

export type FlowRunnerUxOptions = {
  /** Named host UX effects the flow can invoke. */
  effects: EffectRegistry;
  /** Optional per-effect palette metadata (used by `registerKinds`). */
  meta?: Record<string, UxEffectMeta>;
  /** Identifies the flow run in emitted activity. Default `{ id: "flow", source: "flow" }`. */
  actor?: DispatchActor;
  /** Map an effect name to its node-kind name. Default `ux_<effect>`. */
  kindFor?: (effectName: string) => string;
};

export type FlowRunnerUx = {
  /** Executor registry to hand to `<FlowEditor executors>` or `runFlow`. */
  executors: ExecutorRegistry;
  /** Invoke an effect imperatively (also emits activity). */
  dispatch: <R = unknown>(name: string, params?: unknown) => Promise<R>;
  /** All effect names. */
  effectNames: () => string[];
  /** Register a palette node kind per effect (`ux_<effect>`). Idempotent. */
  registerKinds: () => void;
};

const defaultKindFor = (name: string) => `ux_${name}`;

/** Build a FlowRunnerUx from a set of host effects. Framework-agnostic. */
export function createFlowRunnerUx(options: FlowRunnerUxOptions): FlowRunnerUx {
  const {
    effects,
    meta = {},
    actor = { id: "flow", source: "flow" },
    kindFor = defaultKindFor,
  } = options;

  const dispatcher = createEffectDispatcher(effects, { actor, targetKind: "ux" });

  const executors: ExecutorRegistry = {};
  for (const name of Object.keys(effects)) {
    executors[kindFor(name)] = async ({ node }: { node: FlowNode }) => {
      const params = (node.data as { config?: Record<string, unknown> } | undefined)?.config ?? {};
      const result = await dispatcher.dispatch(name, params);
      // A UX effect can drive flow control: if it returns the decision sugar
      // (`{ branch }` or `{ __port }`) — e.g. an interactive "choose" effect that
      // awaits a human pick and returns the chosen port — pass it straight
      // through so runFlow routes on it. Otherwise wrap the result for the feed.
      if (result && typeof result === "object" && ("branch" in result || "__port" in result)) {
        return result;
      }
      return { effect: name, result };
    };
  }

  const registerKinds = () => {
    for (const name of Object.keys(effects)) {
      const m = meta[name] ?? {};
      registerNodeKind({
        name: kindFor(name),
        category: m.category ?? "output",
        label: m.label ?? name,
        description: m.description ?? `Flow-driven UX effect: ${name}.`,
        icon: m.icon ?? "✨",
        accent: m.accent ?? "#8b5cf6",
        inputs: [{ id: "in" }],
        outputs: [],
        configSchema: m.configSchema,
      });
    }
  };

  return {
    executors,
    dispatch: dispatcher.dispatch as FlowRunnerUx["dispatch"],
    effectNames: dispatcher.names,
    registerKinds,
  };
}

/**
 * React hook form — memoizes on the effect-name set + actor id so the returned
 * executors keep a stable identity across renders.
 */
export function useFlowRunnerUx(options: FlowRunnerUxOptions): FlowRunnerUx {
  const key = `${Object.keys(options.effects).sort().join(",")}|${options.actor?.id ?? "flow"}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createFlowRunnerUx(options), [key]);
}
