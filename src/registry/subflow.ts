import { getWorkflowResolver, isResolutionFailure } from "./capabilities";
import { runFlow } from "../runtime/run-flow";
import type { NodeExecutor, RunEvent } from "../types";

/**
 * `@fancy/subflow` — run another workflow and bring its result home.
 *
 * Core, not marketplace: it introduces no third-party dependency. It runs a
 * child graph through the very same engine, so the only thing it needs from the
 * host is where workflows live (`registerWorkflowResolver`).
 *
 * Three output modes, because both halves are genuinely useful:
 *
 *   - `output` — the child's outputs arrive on `out` when it finishes.
 *   - `stream` — the child's events are forwarded live on `stream` as they
 *     happen, so a parent can show progress instead of a spinner.
 *   - `both`   — stream while running AND deliver the final outputs.
 *
 * Recursion is guarded by depth. A workflow that references itself (directly or
 * through a chain) would otherwise recurse until the stack dies, which surfaces
 * as an opaque crash rather than "you built a loop".
 */

export const DEFAULT_MAX_DEPTH = 8;

export type SubflowMode = "output" | "stream" | "both";

export function subflowMode(config: Record<string, unknown>): SubflowMode {
  const mode = config.mode;
  return mode === "stream" || mode === "both" ? mode : "output";
}

/** Ports follow the mode — `stream` only exists when something streams. */
export function subflowPorts(config: Record<string, unknown>) {
  const mode = subflowMode(config);
  const ports = [{ id: "out", label: "result" }];
  if (mode === "stream" || mode === "both") ports.unshift({ id: "stream", label: "stream" });
  return ports;
}

export const subflowExecutor: NodeExecutor = async (ctx) => {
  const config = ((ctx.node.data as any)?.config ?? {}) as Record<string, unknown>;
  const ref = String(config.workflow ?? "").trim();
  if (!ref) ctx.abort("subflow has no workflow reference configured");

  const resolver = getWorkflowResolver();
  if (!resolver) {
    ctx.abort(
      "No workflow resolver registered. Call registerWorkflowResolver() so subflow can find the workflow it references.",
    );
  }

  const maxDepth = Number.isFinite(config.maxDepth) ? Number(config.maxDepth) : DEFAULT_MAX_DEPTH;
  const depth = ctx.depth ?? 0;
  if (depth + 1 > maxDepth) {
    // Name the cause. "Maximum call stack exceeded" tells an author nothing
    // about the workflow they wired into itself.
    ctx.abort(
      `subflow depth limit reached (${maxDepth}) at "${ref}" — a workflow is referencing itself, directly or through a chain.`,
    );
  }

  // An optional pin. A workflow another workflow depends on is an interface:
  // without a pin, someone edits the child and the parent silently runs
  // different logic while still reporting success.
  const pinned = config.version === undefined || config.version === "" ? undefined : Number(config.version);
  if (pinned !== undefined && !Number.isInteger(pinned)) {
    ctx.abort(`subflow "${ref}" has a non-integer version pin (${String(config.version)}).`);
  }

  const resolved = await resolver!(ref, pinned);

  // A mismatch names BOTH versions. Reporting it as "not found" would send an
  // author looking for a workflow that is sitting right there — which is why
  // the resolver can say which of the two failures it hit.
  const child = isResolutionFailure(resolved)
    ? ctx.abort(
        resolved.reason === "version-mismatch"
          ? (resolved.message ??
            `subflow "${ref}" is pinned to version ${pinned}, but the host has ${resolved.available ?? "a different version"}.`)
          : (resolved.message ?? `subflow could not resolve workflow "${ref}"`),
      )
    : resolved;

  if (!child) ctx.abort(`subflow could not resolve workflow "${ref}"`);

  const mode = subflowMode(config);
  const streaming = mode === "stream" || mode === "both";

  const forward = (event: RunEvent) => {
    if (!streaming) return;
    // Surface the child's progress on the PARENT's feed as a log line against
    // this node. Re-emitting the child's raw events would collide with the
    // parent's own node ids — a child's "node-status" for its `output` node is
    // not a status for anything in the parent graph.
    const detail =
      event.type === "node-status"
        ? `${event.nodeId} ${event.status}`
        : event.type === "run-end"
          ? `finished (${event.ok ? "ok" : "failed"})`
          : event.type;
    ctx.emit({
      type: "log",
      nodeId: ctx.node.id,
      level: "info",
      message: `[${ref}] ${detail}`,
    });
  };

  const result = await runFlow(
    child!,
    (config.executors as never) ?? {},
    forward,
    {
      initialInputs: (config.inputs as Record<string, Record<string, unknown>>) ?? {
        // With no explicit mapping, hand the parent's inputs to the child's
        // entry points — the obvious default, and it makes the simple case
        // require no configuration at all.
        __parent: ctx.inputs as Record<string, unknown>,
      },
      depth: depth + 1,
    },
  );

  if (!result.ok) {
    ctx.abort(`subflow "${ref}" failed: ${result.error ?? "unknown error"}`);
  }

  // `stream` alone still emits a final value on `stream` so downstream nodes
  // have something to run on; `both` publishes on every declared port.
  if (mode === "stream") {
    return { __port: "stream", value: result.outputs };
  }
  if (mode === "both") {
    return result.outputs;
  }
  return { __port: "out", value: result.outputs };
};
