import { describe, expect, it } from "vitest";
import { listSchemaComponents, renderSchema } from "@particle-academy/fancy-screens";
import { registerFlowSchema } from "../src/screens";

describe("registerFlowSchema", () => {
  it("makes FlowViewer addressable by name in a ScreenSchema", () => {
    expect(listSchemaComponents()).not.toContain("FlowViewer");

    registerFlowSchema();

    // The whole point: an agent emits { "type": "FlowViewer", ... } as JSON and
    // fancy-screens can resolve it. Without registration the schema renders an
    // "unknown component" placeholder instead of the workflow.
    expect(listSchemaComponents()).toContain("FlowViewer");
  });

  it("resolves a FlowViewer schema node rather than the unknown-component fallback", () => {
    registerFlowSchema();

    const rendered = renderSchema({
      type: "FlowViewer",
      props: { graph: { nodes: [], edges: [] } },
    });

    // fancy-screens returns a placeholder element for an unregistered name;
    // asserting we did NOT get that is what proves resolution, and it is the
    // failure a consumer would actually hit.
    expect(rendered).not.toBeNull();
    expect(JSON.stringify(rendered)).not.toContain("Unknown schema component");
  });

  it("does NOT register FlowEditor", () => {
    registerFlowSchema();

    // Deliberate. FlowEditor needs executors, run handlers and controlled state
    // that cannot be expressed as JSON props, so an agent emitting one would get
    // an editor that renders and does nothing — worse than not offering it.
    expect(listSchemaComponents()).not.toContain("FlowEditor");
  });
});
