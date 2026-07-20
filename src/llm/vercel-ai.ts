/**
 * `@particle-academy/fancy-flow/llm/vercel-ai` — an LLM client backed by the
 * Vercel AI SDK.
 *
 * Core ships the routing but never a provider, so `llm_branch` needs a client
 * before it can run. Making every consumer hand-write one is not "fully
 * functional" — so this adapter ships in the box, on an opt-in subpath, exactly
 * like `/rich-input` wires fancy-cms.
 *
 * The AI SDK is chosen because it fronts every provider (Anthropic, OpenAI,
 * Google, local models). Picking it does NOT force it: `registerLlmClient()`
 * takes any implementation, so a different SDK or a hand-rolled fetch works
 * just as well.
 *
 * ```ts
 * import { anthropic } from "@ai-sdk/anthropic";
 * import { useVercelAiForLlmBranch } from "@particle-academy/fancy-flow/llm/vercel-ai";
 *
 * useVercelAiForLlmBranch({ model: anthropic("claude-sonnet-4-5") });
 * ```
 *
 * `ai` is an OPTIONAL peer — required only by this subpath. The main entry
 * never imports it, so a flow with no AI node pays nothing.
 */
import { Output, generateText, type LanguageModel } from "ai";
import { registerLlmClient, type LlmClient, type LlmRouteRequest } from "../registry/capabilities";

export type VercelAiOptions = {
  /** The model to route with, e.g. `anthropic("claude-sonnet-4-5")`. */
  model: LanguageModel;
  /**
   * Resolve a per-node model. `llm_branch` config can name a provider/model,
   * and only the host knows how to turn those strings into a model instance —
   * core deliberately never maps a name to a provider.
   */
  resolveModel?: (request: LlmRouteRequest) => LanguageModel | undefined;
  /** Extra options merged into every call (temperature, headers, …). */
  callOptions?: Record<string, unknown>;
};

/**
 * Build the client without registering it — handy for tests, or for a host
 * that wants to wrap it.
 */
export function createVercelAiLlmClient(options: VercelAiOptions): LlmClient {
  return {
    async chooseRoute(request) {
      const model = options.resolveModel?.(request) ?? options.model;

      // Constrain the model to the declared ports instead of parsing prose.
      // A choice that can only BE one of the ports is the difference between a
      // routing decision and a guess, and it means the "hallucinated port"
      // guard in the node is a backstop rather than the primary defence.
      const result = await generateText({
        model,
        system: request.system,
        prompt: buildPrompt(request),
        output: Output.choice({
          options: request.routes.map((r) => r.port),
          name: "route",
          description: "The single route this input should follow.",
        }),
        ...(options.callOptions ?? {}),
      } as never);

      const port = String((result as { output?: unknown }).output ?? "");
      return {
        port,
        // The SDK returns the choice, not an explanation. Say where the answer
        // came from rather than inventing a rationale the model never gave.
        reason: `chosen by ${describeModel(model)}`,
      };
    },
  };
}

/** Build the client and install it. Returns an unregister function. */
export function useVercelAiForLlmBranch(options: VercelAiOptions): () => void {
  return registerLlmClient(createVercelAiLlmClient(options));
}

/**
 * Fold the route descriptions into the prompt.
 *
 * The port ids alone are often terse (`billing`, `support`); the descriptions
 * are what the author wrote to distinguish them, so a model that never sees
 * them is choosing on the strength of a label.
 */
export function buildPrompt(request: LlmRouteRequest): string {
  const described = request.routes.filter((r) => r.description);
  if (described.length === 0) return request.prompt;

  const lines = described.map((r) => `- ${r.port}: ${r.description}`).join("\n");
  return `${request.prompt}\n\nRoutes:\n${lines}`;
}

function describeModel(model: LanguageModel): string {
  if (typeof model === "string") return model;
  const id = (model as { modelId?: string }).modelId;
  return id ?? "the configured model";
}
