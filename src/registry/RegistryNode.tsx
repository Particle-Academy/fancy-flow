import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode, NodeRunStatus, PortDescriptor } from "../types";
import { categoryAccent, getNodeKind } from "./registry";

/**
 * RegistryNode — generic node renderer that looks up the node's kind in
 * the registry and applies its `accent`/`label`/`icon`/`renderBody`. Used
 * as the xyflow node component for every registered kind.
 */
function RegistryNodeInner(props: NodeProps<FlowNode>) {
  const kindName = (props.data as any).kind ?? props.type;
  const kind = useMemo(() => getNodeKind(kindName), [kindName]);

  if (!kind) {
    return (
      <div className="ff-node ff-node--unknown">
        <div className="ff-node__header" style={{ background: "#71717a" }}>
          <span className="ff-node__tag">UNKNOWN</span>
          <span className="ff-node__label">{kindName}</span>
        </div>
        <p className="ff-node__desc">No registered kind for "{kindName}".</p>
      </div>
    );
  }

  const data = props.data;
  const status: NodeRunStatus = data.status ?? "idle";
  const accent = kind.accent ?? categoryAccent(kind.category);
  const inputs: PortDescriptor[] = data.inputs ?? kind.inputs ?? defaultInputs(kind.category);
  const outputs: PortDescriptor[] = data.outputs ?? kind.outputs ?? defaultOutputs(kind.category);
  const config = ((data as any).config ?? {}) as Record<string, unknown>;
  const label = data.label ?? kind.label;

  return (
    <div
      className={[
        "ff-node",
        `ff-node--status-${status}`,
        `ff-node--cat-${kind.category}`,
        props.selected ? "ff-node--selected" : "",
      ].filter(Boolean).join(" ")}
      style={{ borderColor: props.selected ? accent : undefined }}
    >
      <header className="ff-node__header" style={{ background: accent }}>
        {kind.icon && <span className="ff-node__icon" aria-hidden>{kind.icon}</span>}
        <span className="ff-node__tag">{kind.label.toUpperCase()}</span>
        <span className="ff-node__label">{label}</span>
        {status !== "idle" && <span className={`ff-node__dot ff-node__dot--${status}`} aria-label={`status ${status}`} />}
      </header>

      {data.description && <p className="ff-node__desc">{data.description}</p>}

      <div className="ff-node__body">
        {kind.renderBody
          ? kind.renderBody({ nodeId: props.id, config: config as any, selected: props.selected ?? false })
          : <DefaultBody config={config} kind={kind.configSchema} />}
      </div>

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

export const RegistryNode = memo(RegistryNodeInner);

function defaultInputs(category: string): PortDescriptor[] {
  return category === "trigger" ? [] : [{ id: "in" }];
}
function defaultOutputs(category: string): PortDescriptor[] {
  return category === "output" ? [] : [{ id: "out" }];
}

function portStyle(i: number, total: number): React.CSSProperties {
  if (total <= 1) return {};
  const slot = (100 / (total + 1)) * (i + 1);
  return { top: `${slot}%` };
}

/**
 * DefaultBody — compact summary of the config values for nodes that
 * don't provide a custom renderBody. Skips fields that look empty.
 */
function DefaultBody({ config, kind }: { config: Record<string, unknown>; kind?: import("./types").ConfigField[] }) {
  const fields = kind ?? [];
  const visible = fields
    .map((f) => ({ field: f, value: config[f.key] }))
    .filter(({ value }) => value !== undefined && value !== "" && value !== null);
  if (visible.length === 0) {
    return <div className="ff-node__body-empty">— configure in the panel</div>;
  }
  return (
    <ul className="ff-node__summary">
      {visible.slice(0, 4).map(({ field, value }) => (
        <li key={field.key}>
          <span className="ff-node__summary-key">{field.label}:</span>
          <span className="ff-node__summary-value">{previewValue(value)}</span>
        </li>
      ))}
      {visible.length > 4 && <li className="ff-node__summary-more">+ {visible.length - 4} more</li>}
    </ul>
  );
}

function previewValue(v: unknown): string {
  if (typeof v === "string") return v.length > 30 ? v.slice(0, 27) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const j = JSON.stringify(v);
    return j.length > 30 ? j.slice(0, 27) + "…" : j;
  } catch {
    return "[object]";
  }
}
