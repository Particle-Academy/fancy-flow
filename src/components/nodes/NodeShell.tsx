import { type ReactNode, memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode, NodeRunStatus, PortDescriptor } from "../../types";

export type NodeShellProps = {
  /** Required: the xyflow node this is rendering. */
  node: NodeProps<FlowNode>;
  /** Accent color for the title bar / status ring. */
  accent: string;
  /** Tag/label shown to the left of the title (e.g. "TRIGGER", "ACTION"). */
  tag: string;
  /** Optional icon glyph (single-character string is fine). */
  icon?: ReactNode;
  /** Whether to show input handles on the left. Defaults true. */
  showInputs?: boolean;
  /** Whether to show output handles on the right. Defaults true. */
  showOutputs?: boolean;
  /** Body content under the title bar. */
  children?: ReactNode;
};

/**
 * Shared chrome for every kit node — title bar, accent border, status ring,
 * port handles. Specific node kinds compose this with their body content.
 */
function NodeShellInner({
  node,
  accent,
  tag,
  icon,
  showInputs = true,
  showOutputs = true,
  children,
}: NodeShellProps) {
  const data = node.data;
  const status: NodeRunStatus = data.status ?? "idle";
  const inputs = data.inputs ?? defaultInputs(showInputs);
  const outputs = data.outputs ?? defaultOutputs(showOutputs);

  return (
    <div
      className={["ff-node", `ff-node--status-${status}`, node.selected ? "ff-node--selected" : ""].filter(Boolean).join(" ")}
      style={{ borderColor: node.selected ? accent : undefined }}
    >
      <header className="ff-node__header" style={{ background: accent }}>
        <span className="ff-node__icon" aria-hidden>{icon ?? null}</span>
        <span className="ff-node__tag">{tag}</span>
        <span className="ff-node__label">{data.label}</span>
        {status !== "idle" && <StatusDot status={status} />}
      </header>

      {data.description && <p className="ff-node__desc">{data.description}</p>}
      {children && <div className="ff-node__body">{children}</div>}
      {data.statusText && <p className="ff-node__status-text">{data.statusText}</p>}

      {inputs.map((p, i) => (
        <Handle
          key={p.id}
          type="target"
          position={Position.Left}
          id={p.id}
          style={portStyle(i, inputs.length)}
          title={p.label ?? p.id}
        />
      ))}
      {outputs.map((p, i) => (
        <Handle
          key={p.id}
          type="source"
          position={Position.Right}
          id={p.id}
          style={portStyle(i, outputs.length)}
          title={p.label ?? p.id}
        />
      ))}
    </div>
  );
}

export const NodeShell = memo(NodeShellInner);

function defaultInputs(show: boolean): PortDescriptor[] {
  return show ? [{ id: "in" }] : [];
}
function defaultOutputs(show: boolean): PortDescriptor[] {
  return show ? [{ id: "out" }] : [];
}

function portStyle(i: number, total: number): React.CSSProperties {
  if (total <= 1) return {};
  const slot = (100 / (total + 1)) * (i + 1);
  return { top: `${slot}%` };
}

function StatusDot({ status }: { status: NodeRunStatus }) {
  return <span className={`ff-node__dot ff-node__dot--${status}`} aria-label={`status ${status}`} />;
}
