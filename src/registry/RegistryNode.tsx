import { memo, useMemo } from "react";
import { Handle, NodeResizer, NodeToolbar, Position, type NodeProps } from "@xyflow/react";
import type { FlowNode, NodeRunStatus, PortDescriptor } from "../types";
import { categoryAccent, getNodeKind } from "./registry";
import { nodeConfig, resolveNodePorts } from "./ports";

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
  const resolved = resolveNodePorts(props, kind);
  const inputs: PortDescriptor[] = resolved.inputs ?? defaultInputs(kind.category);
  const outputs: PortDescriptor[] = resolved.outputs ?? defaultOutputs(kind.category);
  const config = nodeConfig(props);
  const label = data.label ?? kind.label;

  return (
    <div
      className={[
        "ff-node",
        `ff-node--status-${status}`,
        `ff-node--cat-${kind.category}`,
        props.selected ? "ff-node--selected" : "",
        kind.resizable ? "ff-node--resizable" : "",
      ].filter(Boolean).join(" ")}
      style={{ borderColor: props.selected ? accent : undefined }}
    >
      {kind.resizable && (
        <NodeResizer
          isVisible={props.selected ?? false}
          color={accent}
          {...(typeof kind.resizable === "object" ? kind.resizable : {})}
        />
      )}
      {kind.toolbar && (
        <NodeToolbar isVisible={props.selected ?? false}>
          {kind.toolbar({ nodeId: props.id, config: config as any, selected: props.selected ?? false })}
        </NodeToolbar>
      )}
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

      {(data as any).output !== undefined && (
        <p className="ff-node__output" title="Latest output">→ {previewValue((data as any).output)}</p>
      )}

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

const truncate = (s: string, n = 30): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** A short, human name for one item in a repeater/list value. */
function itemLabel(item: unknown): string {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    const name = o.label ?? o.name ?? o.key ?? o.title ?? o.id;
    if (typeof name === "string" && name) return name;
    if (typeof name === "number") return String(name);
    return "item";
  }
  return String(item ?? "");
}

/**
 * A node card's job is to read at a glance, not to be a data dump — so a value
 * is summarised, never `JSON.stringify`d. An array becomes its item names (or a
 * count), an object becomes a field count. Raw JSON on a card was the specific
 * thing to kill: `Fields: [{"key":"answer",…}]` reads as noise.
 */
export function previewValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return truncate(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "none";
    const names = v.slice(0, 3).map(itemLabel).filter(Boolean).join(", ");
    const rest = v.length > 3 ? `, +${v.length - 3}` : "";
    return names ? truncate(names + rest) : `${v.length} item${v.length === 1 ? "" : "s"}`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as object);
    return keys.length === 0 ? "empty" : `${keys.length} field${keys.length === 1 ? "" : "s"}`;
  }
  return "…";
}
