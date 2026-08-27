import { type ReactNode, useId, useMemo } from "react";
import type { FlowNode, FlowGraph} from "../../types";
import type { ConfigField, NodeKindDefinition } from "../../registry/types";
import { categoryAccent, getNodeKind, validateConfig } from "../../registry/registry";
import { getRichInputAdapter } from "../../registry/rich-input";
import { ConfigFieldRenderer, type ConfigFieldRenderFn } from "./ConfigFieldRenderer";

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
  /** Host renderers keyed by field `type`. See {@link ConfigFieldRenderer}. */
  fieldRenderers?: Record<string, ConfigFieldRenderFn>;
  /**
   * Presentation-only visibility policy for schema fields. Returning `false`
   * omits the complete field wrapper (label, description, and control) while
   * leaving the registered kind and its runtime schema untouched.
   */
  fieldFilter?: (context: {
    node: FlowNode;
    kind: NodeKindDefinition;
    field: ConfigField;
  }) => boolean;
  /**
   * The graph the node lives in. Supplying it is what makes the `{{ }}` variable
   * picker context-aware — it reads the UPSTREAM node's declared `outputShape`
   * to list what is actually reachable here (issue #5). Without it the picker
   * still opens, but can only offer the whole input.
   */
  graph?: FlowGraph;
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
  fieldRenderers,
  fieldFilter,
  graph,
  className,
  style,
}: NodeConfigPanelProps) {
  // EVERY hook runs before EVERY early return.
  //
  // The two `useMemo`s below used to sit after the `if (!node)` return, so the
  // panel called no hooks with nothing selected and two with a node — a
  // rules-of-hooks violation that React reports as #310, "rendered more hooks
  // than during the previous render". It survived because nothing in this repo
  // could render a component: the vitest config collected only `.test.ts`.
  // Adding a third hook is what finally made it crash on selecting a node.
  //
  // `uid` gives one prefix per mounted panel, so two panels on a page (a split
  // view, a comparison) cannot mint the same id and steal each other's label
  // clicks.
  const uid = useId();
  const kindName = node ? ((node.data as any).kind ?? node.type) : null;
  const kind = useMemo(() => (kindName ? getNodeKind(kindName) : undefined), [kindName]);
  const config = useMemo(
    () => ((node?.data as any)?.config ?? {}) as Record<string, unknown>,
    [node?.data],
  );

  /**
   * A stable DOM id for one field's control.
   *
   * The field KEY is in the id rather than an index, so the handle survives
   * reordering the schema, and an agent reading `data-ff-field` finds the same
   * element the label points at.
   */
  const fieldId = (key: string) => `${uid}-${key}`;

  if (!node) {
    return (
      <aside className={["ff-panel", "ff-panel--empty", className ?? ""].filter(Boolean).join(" ")} style={style}>
        {header}
        <p className="ff-panel__empty">Select a node to configure it.</p>
      </aside>
    );
  }

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

  const setStatusMsg = (key: "startingMsg" | "stoppingMsg", value: string) =>
    onChange({ ...node, data: { ...node.data, [key]: value } });

  const setConfigValue = (key: string, value: unknown) =>
    onChange({ ...node, data: { ...node.data, config: { ...config, [key]: value } } });

  const configFields = (kind.configSchema ?? []).filter((field) =>
    fieldFilter ? fieldFilter({ node, kind, field }) : true,
  );
  const visibleFieldKeys = new Set(configFields.map((field) => field.key));
  // Validation itself still runs against the complete registered schema. Only
  // its presentation follows fieldFilter: a host-owned hidden value must not
  // leave an impossible warning for a control the host deliberately removed.
  const issues = validateConfig(kind, config).filter((issue) => visibleFieldKeys.has(issue.key));

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
        <span className="ff-panel__head-icon" style={{ background: kind.accent ?? categoryAccent(kind.category) }} aria-hidden>
          {kind.icon}
        </span>
        <span className="ff-panel__head-text">
          <span className="ff-panel__head-kind">{kind.label}</span>
          <span className="ff-panel__head-name">{node.data.label || kind.label}</span>
        </span>
      </header>
      {kind.description && <p className="ff-panel__kind-desc">{kind.description}</p>}

      <div className="ff-panel__field">
        <label className="ff-panel__label" htmlFor={fieldId("label")}>Label</label>
        <input
          id={fieldId("label")}
          data-ff-field="label"
          className="ff-panel__input"
          value={node.data.label ?? ""}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={kind.label}
        />
      </div>

      <div className="ff-panel__field">
        <label className="ff-panel__label" htmlFor={fieldId("description")}>Description</label>
        <textarea
          id={fieldId("description")}
          data-ff-field="description"
          className="ff-panel__input ff-panel__input--textarea"
          rows={2}
          value={node.data.description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {/* Run narration. Node-level and kind-agnostic, so it sits with label and
          description rather than in the kind's configSchema — any node can
          announce itself, and no kind should have to opt in to be allowed to.
          Left blank on most nodes by design: narrating every step buries the
          two or three a person actually follows. */}
      <div className="ff-panel__field">
        <label className="ff-panel__label" htmlFor={fieldId("startingMsg")}>Message when it starts</label>
        <input
          id={fieldId("startingMsg")}
          data-ff-field="startingMsg"
          className="ff-panel__input"
          value={(node.data.startingMsg as string) ?? ""}
          onChange={(e) => setStatusMsg("startingMsg", e.target.value)}
          placeholder="e.g. Starting the deep analysis"
        />
        <p className="ff-panel__hint">Announced just before this node runs. Leave blank to say nothing.</p>
      </div>

      <div className="ff-panel__field">
        <label className="ff-panel__label" htmlFor={fieldId("stoppingMsg")}>Message when it finishes</label>
        <input
          id={fieldId("stoppingMsg")}
          data-ff-field="stoppingMsg"
          className="ff-panel__input"
          value={(node.data.stoppingMsg as string) ?? ""}
          onChange={(e) => setStatusMsg("stoppingMsg", e.target.value)}
          placeholder="e.g. Analysis complete"
        />
        <p className="ff-panel__hint">Announced only if the node succeeds — never after a failure.</p>
      </div>

      {kind.renderPanel ? (
        kind.renderPanel({
          config: config as any,
          onChange: (next) => onChange({ ...node, data: { ...node.data, config: next } }),
          nodeId: node.id,
        })
      ) : (
        <>
          {configFields.length > 0 && <hr className="ff-panel__divider" />}
          {configFields.map((field) => (
            <div key={field.key} className="ff-panel__field">
              <label className="ff-panel__label" htmlFor={fieldId(field.key)}>
                {field.label}
                {field.required && <span className="ff-panel__required" aria-hidden> *</span>}
              </label>
              {field.description && <p className="ff-panel__hint">{field.description}</p>}
              <ConfigFieldRenderer
                id={fieldId(field.key)}
                field={field}
                value={config[field.key]}
                onChange={(v) => setConfigValue(field.key, v)}
                renderCredentialField={renderCredentialField}
                renderDocumentField={documentField}
                fieldRenderers={fieldRenderers}
                graph={graph}
                nodeId={node.id}
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
