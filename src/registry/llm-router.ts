import { getLlmClient, type LlmRoute } from "./capabilities";
import type { NodeExecutor } from "../types";

/**
 * `@fancy/llm_branch` — a SHUTTLE, not an engine.
 *
 * It carries the declared routes and the decision prompt out to whatever LLM
 * client the host registered, and carries the chosen port back down the graph.
 * It contains no provider SDK, no prompt engineering, no response parsing and
 * no retry policy — all of that belongs to the host's client, which is what
 * lets this node live in core without every consumer inheriting an LLM
 * dependency.
 *
 * The one thing it does own is graph integrity, because that is a workflow
 * concern rather than an AI one: a port the model invents must never route.
 */

/** Read the node's declared routes out of config. */
export function declaredRoutes(config: Record<string, unknown>): LlmRoute[] {
  const raw = config.routes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({ port: String((r as any)?.port ?? "").trim(), description: (r as any)?.description }))
    .filter((r) => r.port !== "");
}

/**
 * Where a run goes when the model returns a port that was never offered.
 *
 * Emitting on a port with no edge silently ends the branch — the worst failure
 * mode in a workflow engine, because the run reports success having done
 * nothing. So: the `fallback` port when it exists, else the first declared
 * route, and always loudly.
 */
export function resolveFallbackPort(routes: LlmRoute[], fallbackEnabled: boolean): string {
  if (fallbackEnabled) return "fallback";
  // Callers only reach this with at least one declared route (a node with none
  // aborts earlier), so there is always somewhere safe to land.
  return routes[0]?.port ?? "out";
}

export const llmRouterExecutor: NodeExecutor = async (ctx) => {
  const config = ((ctx.node.data as any)?.config ?? {}) as Record<string, unknown>;
  const routes = declaredRoutes(config);

  if (routes.length === 0) {
    ctx.abort("llm_router has no routes configured");
  }

  const client = getLlmClient();
  if (!client) {
    // Fail loudly rather than guessing a branch. A silent default here would
    // look like the model made a choice.
    ctx.abort(
      "No LLM client registered. Call registerLlmClient() with your provider adapter — fancy-flow ships the routing, not the model call.",
    );
  }

  const fallbackEnabled = config.fallback !== false;

  const choice = await client!.chooseRoute({
    system: typeof config.system === "string" ? config.system : undefined,
    prompt: String(config.prompt ?? ctx.inputs ?? ""),
    routes,
    provider: typeof config.provider === "string" ? config.provider : undefined,
    model: typeof config.model === "string" ? config.model : undefined,
    credential: typeof config.credential === "string" ? config.credential : undefined,
  });

  const offered = new Set(routes.map((r) => r.port));
  let port = choice?.port ?? "";
  let reason = choice?.reason;

  if (!offered.has(port)) {
    const safe = resolveFallbackPort(routes, fallbackEnabled);
    ctx.emit({
      type: "log",
      nodeId: ctx.node.id,
      level: "warn",
      message: `llm_router: model returned "${port || "(nothing)"}", which is not a declared route. Routing to "${safe}".`,
    });
    reason = reason ?? `unrecognised route "${port}"`;
    port = safe;
  }

  // The reason travels WITH the value, so a completed run explains itself
  // without needing the model call replayed.
  return { __port: port, value: { route: port, reason, input: ctx.inputs } };
};
