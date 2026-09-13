import { categoryAccent, getNodeKind } from "../../registry/registry";
import type { FlowNode } from "../../types";

/**
 * A minimap node in its kind's accent, the colour of the node's own header.
 *
 * React Flow's default fills every minimap node with one grey, and in dark mode
 * that is #2b2b2b on a #141414 panel: present in the DOM and invisible on the
 * page. With the header colour the minimap reads as the graph it mirrors, and a
 * trigger, an LLM call and an output are told apart at a glance.
 */
export function minimapNodeColor(node: FlowNode): string {
  const kind = getNodeKind(String(node.data?.kind ?? node.type ?? ""));

  return kind?.accent ?? categoryAccent(kind?.category ?? "custom");
}
