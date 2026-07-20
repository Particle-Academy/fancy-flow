import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPrompt, createVercelAiLlmClient } from "../src/llm/vercel-ai";
import { getLlmClient } from "../src/registry/capabilities";
import type { LlmRouteRequest } from "../src/registry/capabilities";

vi.mock("ai", () => ({
  // Capture what the adapter asks the SDK for, and hand back a fixed choice.
  generateText: vi.fn(async (opts: any) => {
    (globalThis as any).__lastCall = opts;
    return { output: opts.output?.__options?.options?.[0] ?? "billing" };
  }),
  Output: {
    choice: (options: any) => ({ __options: options }),
  },
}));

const req = (over: Partial<LlmRouteRequest> = {}): LlmRouteRequest => ({
  prompt: "customer asks about an invoice",
  routes: [{ port: "billing", description: "money questions" }, { port: "support" }],
  ...over,
});

afterEach(() => {
  delete (globalThis as any).__lastCall;
});

describe("Vercel AI adapter", () => {
  it("constrains the model to the declared ports", async () => {
    // The whole point of structured output: a choice that can only BE one of
    // the ports, rather than prose that has to be parsed and might not match.
    const client = createVercelAiLlmClient({ model: "test-model" as never });
    await client.chooseRoute(req());
    expect((globalThis as any).__lastCall.output.__options.options).toEqual(["billing", "support"]);
  });

  it("returns the chosen port", async () => {
    const client = createVercelAiLlmClient({ model: "test-model" as never });
    const choice = await client.chooseRoute(req());
    expect(choice.port).toBe("billing");
  });

  it("passes the system prompt through", async () => {
    const client = createVercelAiLlmClient({ model: "m" as never });
    await client.chooseRoute(req({ system: "be terse" }));
    expect((globalThis as any).__lastCall.system).toBe("be terse");
  });

  it("folds route descriptions into the prompt", () => {
    // Port ids are terse; the descriptions are what the author wrote to tell
    // them apart, so a model that never sees them is choosing on a label.
    const prompt = buildPrompt(req());
    expect(prompt).toContain("customer asks about an invoice");
    expect(prompt).toContain("- billing: money questions");
  });

  it("leaves the prompt alone when no route has a description", () => {
    const prompt = buildPrompt(req({ routes: [{ port: "a" }, { port: "b" }] }));
    expect(prompt).toBe("customer asks about an invoice");
  });

  it("lets the host resolve a per-request model", async () => {
    // Only the host can turn a config'd provider/model string into an instance
    // — core never maps a name to a provider.
    const resolveModel = vi.fn(() => "resolved-model" as never);
    const client = createVercelAiLlmClient({ model: "default" as never, resolveModel });
    await client.chooseRoute(req({ model: "claude-sonnet-4-5" }));
    expect(resolveModel).toHaveBeenCalled();
    expect((globalThis as any).__lastCall.model).toBe("resolved-model");
  });

  it("falls back to the configured model when the resolver declines", async () => {
    const client = createVercelAiLlmClient({ model: "default" as never, resolveModel: () => undefined });
    await client.chooseRoute(req());
    expect((globalThis as any).__lastCall.model).toBe("default");
  });

  it("merges host call options", async () => {
    const client = createVercelAiLlmClient({ model: "m" as never, callOptions: { temperature: 0 } });
    await client.chooseRoute(req());
    expect((globalThis as any).__lastCall.temperature).toBe(0);
  });

  it("registers itself through the capability seam", async () => {
    const { useVercelAiForLlmBranch } = await import("../src/llm/vercel-ai");
    const off = useVercelAiForLlmBranch({ model: "m" as never });
    expect(getLlmClient()).not.toBeNull();
    off();
    expect(getLlmClient()).toBeNull();
  });
});
