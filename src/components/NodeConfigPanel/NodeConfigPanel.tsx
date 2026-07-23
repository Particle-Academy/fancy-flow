import { type ReactNode, useMemo } from "react";
import type { FlowNode } from "../../types";
import { getNodeKind, validateConfig } from "../../registry/registry";
import { getRichInputAdapter } from "../../registry/rich-input";
import { ConfigFieldRenderer } from "./ConfigFieldRenderer";

export type NodeConfigPanelProps = {
  /** Currently-selected node — pass null to render the empty state. */
  node: FlowNode | null;
  /** Called when the user edits the node label, description, or config. */
  onChange: (next: FlowNode) => void;
  /**
   * Called when the user deletes the node from the panel. When provided, the
   * panel renders a "Delete node" button while a node is selected — so the
   * delete affordance lives WITH the panel (a dev composing their own editor
   * gets it for free), rather than in a host toolbar it has to re-implement.
   */
  onDelete?: (node: FlowNode) => void;
  /** Label for the delete button. Default "Delete node". */
  deleteLabel?: string;
  /** Optional header content (e.g. close button). */
  header?: ReactNode;
  /** Optional credential picker hook — host renders the picker. */
  renderCredentialField?: (props: {
    credentialType: string;
    value: unknown;
    onChange: (next: unknown) => void;
  }) => ReactNode;
  /**
   * Optional document editor hook — host renders the editor for `document`
   * fields. Lets rich authored content live in node config without fancy-flow
   * taking on a document model.
   */
  renderDocumentField?: (props: {
    documentType?: string;
    value: unknown;
    onChange: (next: unknown) => void;
  }) => ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * NodeConfigPanel — schema-driven form for the selected node. Defers to
 * `kind.renderPanel` if the kind opts out of the auto-form.
 */
export function NodeConfigPanel({
  node,
  onChange,
  onDelete,
  deleteLabel = "Delete node",
  header,
  renderCredentialField,
  renderDocumentField,
  className,
  style,
}: NodeConfigPanelProps) {
  if (!node) {
    return (
      <aside className={["ff-panel", "ff-panel--empty", className ?? ""].filter(Boolean).join(" ")} style={style}>
        {header}
        <p className="ff-panel__empty">Select a node to configure it.</p>
      </aside>
    );
  }

  const kindName = (node.data as any).kind ?? node.type;
  const kind = useMemo(() => getNodeKind(kindName), [kindName]);
  const config = useMemo(() => ((node.data as any).config ?? {}) as Record<string, unknown>, [node.data]);

  if (!kind) {
    return (
      <aside className={["ff-panel", className ?? ""].filter(Boolean).join(" ")} style={style}>
        {header}
        <p className="ff-panel__empty">Unknown kind: {kindName}</p>
        {onDelete && (
          <div className="ff-panel__actions">
            <button
              type="button"
              className="ff-panel__delete"
              data-action="delete-node"
              onClick={() => onDelete(node)}
              title="Delete this node (Del / Backspace)"
            >
              ✕ {deleteLabel}
            </button>
          </div>
        )}
      </aside>
    );
  }

  const setLabel = (label: string) =>
    onChange({ ...node, data: { ...node.data, label } });

  const setDescription = (description: string) =>
    onChange({ ...node, data: { ...node.data, description } });

  const setConfigValue = (key: string, value: unknown) =>
    onChange({ ...node, data: { ...node.data, config: { ...config, [key]: value } } });

  const issues = validateConfig(kind, config);

  // An explicit prop wins; otherwise fall back to the rich-input adapter, so a
  // single registerRichInputAdapter() call enables BOTH authoring here and the
  // in-node preview without the host wiring the same editor twice.
  const adapter = getRichInputAdapter();
  const documentField = renderDocumentField
    ?? (adapter?.renderEditor
      ? ({ value, onChange: set }: { value: unknown; onChange: (n: unknown) => void }) =>
          adapter.renderEditor!({ value, onChange: set })
      : undefined);

  return (
    <aside className={["ff-panel", className ?? ""].filter(Boolean).join(" ")} style={style}>
      {header}
      <header className="ff-panel__header">
        <span className="ff-panel__kind-tag">{kind.label}</span>
        {kind.description && <p className="ff-panel__kind-desc">{kind.description}</p>}
      </header>

      <div className="ff-panel__field">
        <label className="ff-panel__label">Label</label>
        <input
          className="ff-panel__input"
          value={node.data.label ?? ""}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind.label}
        />
      </div>

      <div className="ff-panel__field">
        <label className="ff-panel__label">Description</label>
        <textarea
          className="ff-panel__input ff-panel__input--textarea"
          rows={2}
          value={node.data.description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {kind.renderPanel ? (
        kind.renderPanel({
          config: config as any,
          onChange: (next) => onChange({ ...node, data: { ...node.data, config: next } }),
          nodeId: node.id,
        })
      ) : (
        <>
          {(kind.configSchema ?? []).length > 0 && <hr className="ff-panel__divider" />}
          {(kind.configSchema ?? []).map((field) => (
            <div key={field.key} className="ff-panel__field">
              <label className="ff-panel__label">
                {field.label}
                {field.required && <span className="ff-panel__required" aria-hidden> *</span>}
              </label>
              {field.description && <p className="ff-panel__hint">{field.description}</p>}
              <ConfigFieldRenderer
                field={field}
                value={config[field.key]}
                onChange={(v) => setConfigValue(field.key, v)}
                renderCredentialField={renderCredentialField}
                renderDocumentField={documentField}
              />
            </div>
          ))}
        </>
      )}

      {issues.length > 0 && (
        <div className="ff-panel__issues">
          {issues.map((iss) => (
            <p key={iss.key} className="ff-panel__issue">⚠ {iss.message}</p>
          ))}
        </div>
      )}

      {onDelete && (
        <div className="ff-panel__actions">
          <button
            type="button"
            className="ff-panel__delete"
            data-action="delete-node"
            onClick={() => onDelete(node)}
            title="Delete this node (Del / Backspace)"
          >
            ✕ {deleteLabel}
          </button>
        </div>
      )}
    </aside>
  );
}
