/**
 * `@particle-academy/fancy-flow/llm/prism` — route `llm_branch` through a
 * Prism-backed endpoint on your own server.
 *
 * Prism is a PHP library, so there is nothing to import here and no SDK to
 * install: this adapter POSTs the routing question to a route you own, and that
 * route answers it with `Prism\Prism`. That keeps provider config, API keys,
 * fallbacks and token accounting in exactly one place — the same place the rest
 * of a Laravel app already uses — instead of adding a second LLM stack in the
 * browser.
 *
 * It is also the lighter of the two shipped adapters. `/llm/vercel-ai` needs the
 * `ai` package as an optional peer; this one needs nothing but `fetch`.
 *
 * ```ts
 * import { usePrismForLlmBranch } from "@particle-academy/fancy-flow/llm/prism";
 *
 * usePrismForLlmBranch({ endpoint: "/api/flow/llm-route" });
 * ```
 *
 * The endpoint receives the `LlmRouteRequest` as JSON and must answer with
 * `{ "port": "<one of the requested ports>", "reason": "…" }`. That is the same
 * shape `fancy-flow-php`'s `LlmRouteRequest` / `LlmRouteChoice` already model,
 * so ONE route can serve both the editor's preview runs and server-side
 * execution — the two runtimes ask the identical question.
 *
 * A sketch of the Laravel side:
 *
 * ```php
 * Route::post('/api/flow/llm-route', function (Request $r) {
 *     $request = LlmRouteRequest::fromArray($r->all());
 *     return response()->json(app(PrismLlmClient::class)->chooseRoute($request));
 * });
 * ```
 */
import { registerLlmClient, type LlmClient, type LlmRouteChoice, type LlmRouteRequest } from "../registry/capabilities";

export type PrismLlmOptions = {
  /** The route on your server that answers the routing question. */
  endpoint: string;
  /** Extra headers merged into the request (auth, tenancy, …). */
  headers?: Record<string, string>;
  /**
   * Cookie policy. Defaults to `"same-origin"` so a session-authenticated
   * Laravel route works without extra wiring.
   */
  credentials?: RequestCredentials;
  /**
   * Send Laravel's `X-XSRF-TOKEN` header, read from the `XSRF-TOKEN` cookie.
   * Default `true` — without it a session-auth POST is rejected by the CSRF
   * middleware, which is the first thing that goes wrong otherwise.
   */
  csrf?: boolean;
  /** Swap the fetch implementation (tests, SSR, an instrumented client). */
  fetch?: typeof globalThis.fetch;
};

/**
 * Build the client without registering it — handy for tests, or for a host that
 * wants to wrap it.
 */
export function createPrismLlmClient(options: PrismLlmOptions): LlmClient {
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    async chooseRoute(request: LlmRouteRequest): Promise<LlmRouteChoice> {
      if (typeof doFetch !== "function") {
        throw new Error(
          "fancy-flow/llm/prism: no fetch available. Pass `fetch` in the options for SSR or Node < 18.",
        );
      }

      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
        ...(options.headers ?? {}),
      };

      if (options.csrf !== false) {
        const token = readXsrfCookie();
        if (token && !("x-xsrf-token" in lower(headers))) headers["X-XSRF-TOKEN"] = token;
      }

      const response = await doFetch(options.endpoint, {
        method: "POST",
        headers,
        credentials: options.credentials ?? "same-origin",
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(
          `fancy-flow/llm/prism: ${options.endpoint} answered ${response.status}. ` +
            "The route must return { port, reason? } as JSON.",
        );
      }

      const body = (await response.json()) as Partial<LlmRouteChoice> | null;
      const port = typeof body?.port === "string" ? body.port : "";

      // A port nobody declared must NEVER route. Emitting on a port with no edge
      // silently ends the branch and the run reports success having done
      // nothing, so a bad answer has to fail loudly here rather than quietly
      // downstream. The node's own fallback handling is the backstop, not this.
      const declared = request.routes.map((r) => r.port);
      if (!declared.includes(port)) {
        throw new Error(
          `fancy-flow/llm/prism: ${options.endpoint} returned port ${JSON.stringify(port)}, ` +
            `which is not one of the declared routes (${declared.join(", ") || "none"}).`,
        );
      }

      return {
        port,
        reason: typeof body?.reason === "string" && body.reason ? body.reason : "chosen by Prism",
      };
    },
  };
}

/** Build the client and install it. Returns an unregister function. */
export function usePrismForLlmBranch(options: PrismLlmOptions): () => void {
  return registerLlmClient(createPrismLlmClient(options));
}

const lower = (h: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

/** Laravel URL-encodes the XSRF cookie; the header wants it decoded. */
function readXsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}
