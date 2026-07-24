import { memo } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "../../types";
import { categoryAccent } from "../../registry/registry";

/**
 * LaneNode — a resizable swimlane band. A portless container: child nodes are
 * parented into it (`parentId` + `extent:'parent'`) and render on top, so this
 * node is just the titled background. Wired as the `@particle-academy/lane`
 * kind's `component`, so `buildNodeTypes` uses it instead of the default card.
 */
function LaneNodeInner(props: NodeProps<FlowNode>) {
  const data = props.data as any;
  const config = data.config ?? {};
  const title: string = config.title ?? data.label ?? "Lane";
  const orientation: string = config.orientation ?? "horizontal";
  const accent: string = config.color ?? data.color ?? categoryAccent("layout");
  return (
    <div
      className={["ff-lane", `ff-lane--${orientation}`, props.selected ? "ff-lane--selected" : ""]
        .filter(Boolean)
        .join(" ")}
      style={{ borderColor: props.selected ? accent : undefined }}
    >
      <NodeResizer isVisible={props.selected ?? false} color={accent} minWidth={160} minHeight={72} />
      <div className="ff-lane__header" style={{ background: accent }}>
        <span className="ff-lane__title">{title}</span>
      </div>
    </div>
  );
}

export const LaneNode = memo(LaneNodeInner);
