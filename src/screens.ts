// /screens subpath — the ONLY module that imports fancy-screens (optional
// peer). Keeps the base `.` import graph free of it, so an app that never
// touches fancy-screens never pays for it.
import { registerSchemaComponents } from "@particle-academy/fancy-screens";
import type { ComponentType } from "react";
import { FlowViewer } from "./components/FlowViewer";

/**
 * Register fancy-flow's components with fancy-screens, so an agent-emitted
 * `ScreenSchema` can place a workflow in a page:
 *
 * ```json
 * { "type": "FlowViewer", "props": { "graph": { "nodes": [], "edges": [] } } }
 * ```
 *
 * Call once at host startup.
 *
 * **Only the VIEWER is registered, deliberately.** A schema is JSON an agent
 * emits, and `FlowEditor` needs executors, run handlers and controlled state
 * that cannot be expressed as JSON props — registering it would let an agent
 * emit an editor that renders but does nothing, which is worse than not
 * offering it. The viewer is complete from props alone, which is exactly what
 * makes it schema-safe.
 */
export function registerFlowSchema(): void {
  registerSchemaComponents({
    FlowViewer: FlowViewer as unknown as ComponentType<Record<string, unknown>>,
  });
}

export { FlowViewer } from "./components/FlowViewer";
export type { FlowViewerProps, FlowViewerClassNames, FlowNodeStatus } from "./components/FlowViewer";
