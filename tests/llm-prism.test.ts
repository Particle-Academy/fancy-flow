// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPrismLlmClient, usePrismForLlmBranch } from "../src/llm/prism";
import { getLlmClient } from "../src/registry/capabilities";
import type { LlmRouteRequest } from "../src/registry/capabilities";

const request: LlmRouteRequest = {
  prompt: "I want a refund",
  routes: [
    { port: "billing", description: "Refunds, invoices, charges." },
    { port: "technical", description: "Errors, bugs, logins." },
  ],
};

/** A fetch double that records the call and answers with the given body. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, reqInit: RequestInit) => {
    calls.push({ url, init: reqInit });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    } as unknown as Response;
  });
  return { fn: fn as unknown as typeof globalThis.fetch, calls };
}

const teardown: Array<() => void> = [];
afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

describe("llm/prism — routing through a host endpoint", () => {
  it("posts the route request and returns the chosen port", async () => {
    const { fn, calls } = stubFetch({ port: "billing", reason: "mentions a refund" });
    const client = createPrismLlmClient({ endpoint: "/api/flow/llm-route", fetch: fn, csrf: false });

    await expect(client.chooseRoute(request)).resolves.toEqual({
      port: "billing",
      reason: "mentions a refund",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/flow/llm-route");
    expect(calls[0]!.init.method).toBe("POST");
    // The body is the LlmRouteRequest verbatim — the same shape fancy-flow-php's
    // LlmRouteRequest models, so one endpoint can serve both runtimes.
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(request);
  });

  it("imports no SDK — it is fetch and nothing else", () => {
    // Resolved from cwd, not `import.meta.url`: this file runs under jsdom,
    // where import.meta.url is an http:// URL and fileURLToPath rejects it.
    const source = readFileSync(resolve(process.cwd(), "src/llm/prism.ts"), "utf8");
    // Strip comments first — the docblock carries a usage example whose import
    // line is not a real dependency, and counting it would make this assert the
    // opposite of what it claims.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    // Only the local capability seam. No `ai`, no provider, nothing to install —
    // which is the whole point next to /llm/vercel-ai's optional `ai` peer.
    expect(imports).toEqual(["../registry/capabilities"]);
  });

  it("REFUSES a port that was never declared", async () => {
    // The standing rule: a port the model invents must never route. Emitting on
    // a port with no edge silently ends the branch while the run reports
    // success, so a bad answer has to fail loudly at the source.
    const { fn } = stubFetch({ port: "escalate", reason: "made this up" });
    const client = createPrismLlmClient({ endpoint: "/x", fetch: fn, csrf: false });

    await expect(client.chooseRoute(request)).rejects.toThrow(/not one of the declared routes/i);
  });

  it("fails loudly on a non-2xx answer rather than routing anyway", async () => {
    const { fn } = stubFetch({}, { ok: false, status: 500 });
    const client = createPrismLlmClient({ endpoint: "/x", fetch: fn, csrf: false });

    await expect(client.chooseRoute(request)).rejects.toThrow(/answered 500/);
  });

  it("falls back to a truthful reason when the server omits one", async () => {
    const { fn } = stubFetch({ port: "technical" });
    const client = createPrismLlmClient({ endpoint: "/x", fetch: fn, csrf: false });

    // Says where the answer came from instead of inventing a rationale.
    await expect(client.chooseRoute(request)).resolves.toEqual({
      port: "technical",
      reason: "chosen by Prism",
    });
  });

  it("sends Laravel's CSRF header, decoded, when the cookie is present", async () => {
    const { fn, calls } = stubFetch({ port: "billing" });
    const original = document.cookie;
    document.cookie = "XSRF-TOKEN=abc%3D%3D";

    try {
      const client = createPrismLlmClient({ endpoint: "/x", fetch: fn });
      await client.chooseRoute(request);
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers["X-XSRF-TOKEN"]).toBe("abc==");
      expect(calls[0]!.init.credentials).toBe("same-origin");
    } finally {
      document.cookie = original;
    }
  });

  it("registers itself as the flow's LLM client, and unregisters", async () => {
    const { fn } = stubFetch({ port: "billing" });
    const unregister = usePrismForLlmBranch({ endpoint: "/x", fetch: fn, csrf: false });
    teardown.push(unregister);

    expect(getLlmClient()).not.toBeNull();
    unregister();
    expect(getLlmClient()).toBeNull();
  });
});
