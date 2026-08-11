import { type ReactNode, useMemo, useRef, useState } from "react";
import { ExpressionField } from "./ExpressionField";
import type { FlowGraph } from "../../types";
import type {
  ConfigField,
  KeyValueConfigField,
  RepeaterConfigField,
  TextConfigField,
} from "../../registry/types";

/** What a host renderer is handed. */
export type ConfigFieldRenderContext = {
  field: ConfigField;
  value: unknown;
  onChange: (next: unknown) => void;
  /** The id the panel's `<label>` points at. Put it on your control. */
  id?: string;
};

/**
 * Render one field. Return `null` to fall back to the package's own rendering,
 * so a host can claim a type conditionally instead of reimplementing every case.
 *
 * Named `...Fn` because `ConfigFieldRenderer` is already the component this
 * module exports; two things with one name in a public API is a paper cut a
 * consumer pays for, not us.
 */
export type ConfigFieldRenderFn = (ctx: ConfigFieldRenderContext) => ReactNode;

export type ConfigFieldRendererProps = {
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
  /**
   * DOM id for the control this renders.
   *
   * Supplied by the caller rather than generated here so the panel's `<label>`
   * can point at it — a label beside a control is not a label attached to one.
   * Also the agent-facing handle: the Human+ contract asks that every
   * interactive element have a stable identity so an agent targets it instead
   * of guessing at the DOM, and until this existed nothing in the editor had
   * one.
   */
  id?: string;
  renderCredentialField?: (props: {
    credentialType: string;
    value: unknown;
    onChange: (next: unknown) => void;
  }) => ReactNode;
  /**
   * Editor for `document` fields. fancy-flow stores the document but never
   * interprets it — the host owns the editing surface, exactly as it does for
   * `credential`. This is the seam for rich human-input steps (authored pages,
   * required reading, multi-section forms) without the package depending on
   * any particular document model.
   */
  renderDocumentField?: (props: {
    documentType?: string;
    value: unknown;
    onChange: (next: unknown) => void;
  }) => ReactNode;
  /**
   * Host renderers keyed by field `type`.
   *
   * The generic form of `renderDocumentField` / `renderCredentialField`: those
   * cover two types the package deliberately does not interpret, this covers
   * any type at all — including one the package has never heard of.
   *
   * Without it, a richer field had to be rendered OUTSIDE the panel, so that
   * node's config stopped living where every other field does. An unknown type
   * also fell through to `default:` and rendered nothing, so the schema said the
   * field existed and the panel showed empty space.
   *
   * Consulted BEFORE the built-in switch, so a host can also replace a built-in
   * (react-fancy inputs, say) through the same seam rather than a second one.
   */
  fieldRenderers?: Record<string, ConfigFieldRenderFn>;
  /**
   * The graph and the node being edited — what makes the `{{ }}` picker
   * CONTEXT-aware rather than a static list. Optional: a panel composed without
   * them still renders, it just cannot offer node-specific variables.
   */
  graph?: FlowGraph;
  nodeId?: string;
};

/**
 * ConfigFieldRenderer — dispatches to the right input element per field type.
 *
 * Plain HTML inputs styled via the package's CSS so the package stays
 * standalone (no react-fancy import required) and every surface stays themeable
 * through the `--ff-*` token layer. Hosts that want react-fancy form components
 * can supply their own field renderers via the kind's `renderPanel`.
 *
 * Each control carries the caller's `id` and a `data-ff-field` handle keyed by
 * the field, so a label can point at it and an agent can find it by name.
 */
export function ConfigFieldRenderer({
  field,
  value,
  onChange,
  id,
  renderCredentialField,
  renderDocumentField,
  fieldRenderers,
  graph,
  nodeId,
}: ConfigFieldRendererProps) {
  /** Applied to whichever control this field renders. */
  const handle = { id, "data-ff-field": field.key } as const;

  // Host renderers win, and `null` means "you take it" — so claiming a type
  // conditionally does not mean reimplementing the rest.
  const custom = fieldRenderers?.[field.type];
  if (custom) {
    const rendered = custom({ field, value, onChange, id });
    if (rendered !== null && rendered !== undefined) return <>{rendered}</>;
  }

  switch (field.type) {
    case "text": {
      // Declaring `choices` turns a text field into a picker without changing
      // its type or the shape of the value it stores.
      if (field.choices?.length) {
        return <ChoiceField field={field} value={value} onChange={onChange} />;
      }
      return (
        <input
          {...handle}
          className="ff-panel__input"
          type="text"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }

    case "textarea":
      return (
        <textarea
          {...handle}
          className="ff-panel__input ff-panel__input--textarea"
          rows={field.rows ?? 4}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
      return (
        <input
          {...handle}
          className="ff-panel__input"
          type="number"
          value={(value as number) ?? ""}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );

    case "switch":
      return (
        <label className="ff-panel__switch">
          <input
            {...handle}
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="ff-panel__switch-slider" />
        </label>
      );

    case "select":
      return (
        <select
          {...handle}
          className="ff-panel__input"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>—</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      );

    case "json":
      return <JsonField value={value} onChange={onChange} rows={field.rows} handle={handle} />;

    case "expression":
      return (
        <ExpressionField
          handle={handle}
          value={(value as string) ?? ""}
          onChange={onChange}
          placeholder={field.example ?? "{{ $json.field }}"}
          graph={graph}
          nodeId={nodeId}
        />
      );

    case "credential":
      if (renderCredentialField) {
        return <>{renderCredentialField({ credentialType: field.credentialType, value, onChange })}</>;
      }
      return (
        <input
          className="ff-panel__input ff-panel__input--credential"
          type="text"
          value={(value as string) ?? ""}
          placeholder={`Credential reference (${field.credentialType})`}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "repeater":
      return (
        <RepeaterField
          id={id}
          field={field}
          value={value}
          onChange={onChange}
          renderCredentialField={renderCredentialField}
          renderDocumentField={renderDocumentField}
          fieldRenderers={fieldRenderers}
          graph={graph}
          nodeId={nodeId}
        />
      );

    case "keyvalue":
      return <KeyValueField id={id} field={field} value={value} onChange={onChange} />;

    case "document":
      if (renderDocumentField) {
        return <>{renderDocumentField({ documentType: field.documentType, value, onChange })}</>;
      }
      return (
        <p className="ff-panel__hint ff-panel__hint--missing">
          No document editor supplied. Pass <code>renderDocumentField</code> to
          NodeConfigPanel to author this field.
        </p>
      );

    default:
      return null;
  }
}

/** Normalize the `choices` shorthand — a bare string means value === label. */
export function normalizeChoices(
  choices: NonNullable<TextConfigField["choices"]>,
): Array<{ value: string; label: string }> {
  return choices.map((c) =>
    typeof c === "string" ? { value: c, label: c } : { value: c.value, label: c.label ?? c.value },
  );
}

/**
 * ChoiceField — a text field rendered as a select because the kind declared
 * `choices`.
 *
 * A stored value that is no longer among the choices is appended as an option
 * instead of being dropped. Choices are authored data and can change after
 * configs are saved; silently resetting the author's value on render would
 * lose work with no indication it happened.
 */
function ChoiceField({
  field,
  value,
  onChange,
}: {
  field: TextConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const options = normalizeChoices(field.choices ?? []);
  const current = typeof value === "string" ? value : "";
  const known = options.some((o) => o.value === current);

  return (
    <select
      className="ff-panel__input"
      value={current}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="" disabled>{field.placeholder ?? "—"}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
      {current !== "" && !known && (
        <option value={current}>{current} (not in list)</option>
      )}
    </select>
  );
}

/**
 * RepeaterField — editable list of objects, each row driven by the field's
 * own sub-schema. Rows carry stable `data-ff-repeater-row` indices so an
 * agent can target a specific row without guessing DOM.
 */
function RepeaterField({
  id,
  field,
  value,
  onChange,
  graph,
  nodeId,
  renderCredentialField,
  renderDocumentField,
  fieldRenderers,
}: {
  id?: string;
  field: RepeaterConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
  renderCredentialField?: ConfigFieldRendererProps["renderCredentialField"];
  renderDocumentField?: ConfigFieldRendererProps["renderDocumentField"];
  fieldRenderers?: ConfigFieldRendererProps["fieldRenderers"];
  graph?: FlowGraph;
  nodeId?: string;
}) {
  const rows: Array<Record<string, unknown>> = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const max = field.maxItems ?? Infinity;
  const min = field.minItems ?? 0;

  const replace = (next: Array<Record<string, unknown>>) => onChange(next);

  const addRow = () => {
    const blank: Record<string, unknown> = {};
    for (const f of field.fields) {
      if ("default" in f && f.default !== undefined) blank[f.key] = f.default;
    }
    replace([...rows, blank]);
  };

  const removeRow = (i: number) => replace(rows.filter((_, idx) => idx !== i));

  const moveRow = (i: number, delta: number) => {
    const target = i + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[i], next[target]] = [next[target], next[i]];
    replace(next);
  };

  const setCell = (i: number, key: string, cell: unknown) =>
    replace(rows.map((row, idx) => (idx === i ? { ...row, [key]: cell } : row)));

  const rowTitle = (row: Record<string, unknown>, i: number): string => {
    const key = field.titleKey ?? field.fields[0]?.key;
    const raw = key ? row[key] : undefined;
    if (typeof raw === "string" && raw.trim() !== "") return raw;
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
    return `Item ${i + 1}`;
  };

  return (
    <div id={id} role="group" className="ff-repeater" data-ff-repeater={field.key} data-ff-field={field.key}>
      {rows.length === 0 && <p className="ff-repeater__empty">None yet.</p>}

      {rows.map((row, i) => (
        <div className="ff-repeater__row" key={i} data-ff-repeater-row={i}>
          <div className="ff-repeater__row-head">
            <span className="ff-repeater__row-title">{rowTitle(row, i)}</span>
            <div className="ff-repeater__row-actions">
              <button
                type="button"
                className="ff-repeater__btn"
                onClick={() => moveRow(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${rowTitle(row, i)} up`}
              >↑</button>
              <button
                type="button"
                className="ff-repeater__btn"
                onClick={() => moveRow(i, 1)}
                disabled={i === rows.length - 1}
                aria-label={`Move ${rowTitle(row, i)} down`}
              >↓</button>
              <button
                type="button"
                className="ff-repeater__btn ff-repeater__btn--danger"
                onClick={() => removeRow(i)}
                disabled={rows.length <= min}
                aria-label={`Remove ${rowTitle(row, i)}`}
              >✕</button>
            </div>
          </div>

          {field.fields.map((sub) => (
            <div className="ff-repeater__cell" key={sub.key}>
              <label className="ff-panel__label ff-panel__label--sub">
                {sub.label}
                {sub.required && <span className="ff-panel__required" aria-hidden> *</span>}
              </label>
              <ConfigFieldRenderer
                graph={graph}
                nodeId={nodeId}
                field={sub}
                value={row[sub.key]}
                onChange={(cell) => setCell(i, sub.key, cell)}
                renderCredentialField={renderCredentialField}
                renderDocumentField={renderDocumentField}
                fieldRenderers={fieldRenderers}
              />
            </div>
          ))}
        </div>
      ))}

      <button
        type="button"
        className="ff-repeater__add"
        onClick={addRow}
        disabled={rows.length >= max}
      >
        + {field.addLabel ?? "Add"}
      </button>
    </div>
  );
}

/**
 * KeyValueField — editable string→string map.
 *
 * Renaming a key preserves insertion order (rebuilding the object rather than
 * delete-then-add), so rows don't jump around while the author is typing.
 */
function KeyValueField({
  id,
  field,
  value,
  onChange,
}: {
  id?: string;
  field: KeyValueConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const map = (value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {}) as Record<string, string>;
  const entries = Object.entries(map);

  const commit = (next: Array<[string, string]>) => {
    const obj: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k === "") continue;
      obj[k] = v;
    }
    onChange(obj);
  };

  const setKey = (i: number, key: string) =>
    commit(entries.map(([k, v], idx) => (idx === i ? [key, v] : [k, v])));
  const setVal = (i: number, val: string) =>
    commit(entries.map(([k, v], idx) => (idx === i ? [k, val] : [k, v])));
  const remove = (i: number) => commit(entries.filter((_, idx) => idx !== i));
  const add = () => commit([...entries, ["", ""]]);

  return (
    <div id={id} role="group" className="ff-keyvalue" data-ff-keyvalue={field.key} data-ff-field={field.key}>
      {entries.length > 0 && (
        <div className="ff-keyvalue__head">
          <span>{field.keyLabel ?? "Key"}</span>
          <span>{field.valueLabel ?? "Value"}</span>
          <span />
        </div>
      )}

      {entries.map(([k, v], i) => (
        <div className="ff-keyvalue__row" key={i} data-ff-keyvalue-row={i}>
          <input
            className="ff-panel__input"
            value={k}
            placeholder={field.keyPlaceholder}
            aria-label={`${field.keyLabel ?? "Key"} ${i + 1}`}
            onChange={(e) => setKey(i, e.target.value)}
          />
          {field.valueOptions ? (
            <select
              className="ff-panel__input"
              value={v ?? ""}
              aria-label={`${field.valueLabel ?? "Value"} ${i + 1}`}
              onChange={(e) => setVal(i, e.target.value)}
            >
              <option value="" disabled>—</option>
              {field.valueOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ) : (
            <input
              className="ff-panel__input"
              value={v ?? ""}
              placeholder={field.valuePlaceholder}
              aria-label={`${field.valueLabel ?? "Value"} ${i + 1}`}
              onChange={(e) => setVal(i, e.target.value)}
            />
          )}
          <button
            type="button"
            className="ff-repeater__btn ff-repeater__btn--danger"
            onClick={() => remove(i)}
            aria-label={`Remove ${k || `entry ${i + 1}`}`}
          >✕</button>
        </div>
      ))}

      <button type="button" className="ff-repeater__add" onClick={add}>
        + {field.addLabel ?? "Add"}
      </button>
    </div>
  );
}

/**
 * JsonField — the built-in fallback for `type: "json"`.
 *
 * **It used to eat invalid input.** Parsing happened on blur and the `catch`
 * block was empty save for a comment claiming the visual would revert. It could
 * not: the textarea was uncontrolled, so the broken text stayed on screen while
 * the config silently kept its previous value. The panel showed one document
 * and the node ran another, with nothing anywhere saying so — and a missing
 * comma is not a rare event in an `api_request` body.
 *
 * Now the text is a real buffer, the parse error is reported, and the config is
 * still never written from unparseable text. Refusing to store garbage was
 * right; doing it silently was not.
 *
 * The error appears on blur rather than per keystroke — every partially-typed
 * object is invalid on the way to being valid, and flagging that is noise.
 *
 * Hosts on react-fancy can swap this for a real typed editor by passing
 * `fieldRenderers` from `@particle-academy/fancy-flow/fields/react-fancy`.
 */
function JsonField({
  value,
  onChange,
  rows,
  handle,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  rows?: number;
  handle: { id?: string; "data-ff-field": string };
}) {
  const serialized = useMemo(() => {
    try {
      return value === undefined ? "" : JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }, [value]);

  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Two refs, because "the props changed" and "our own edit came back" are
  // different events and only the first should touch the buffer.
  const lastProps = useRef(serialized);
  const committed = useRef<string | null>(null);

  // Re-sync on a genuinely EXTERNAL change — an undo, an agent write, another
  // node selected into the same panel.
  //
  // Comparing props against previous props (not against our own last commit) is
  // what keeps this from fighting a host that doesn't apply changes
  // immediately: a debounced or read-only host leaves `value` alone, which used
  // to read as "reverted externally" and wiped whatever had just been typed.
  // And skipping when the incoming value is our own commit is what stops the
  // author's `{"a":1}` being reformatted onto four lines mid-edit.
  if (serialized !== lastProps.current) {
    lastProps.current = serialized;
    if (serialized !== committed.current) {
      setText(serialized);
      setError(null);
      setTouched(false);
    }
  }

  /** Parse and commit; returns the message when it cannot. */
  const commit = (next: string): string | null => {
    const trimmed = next.trim();
    if (trimmed === "") {
      committed.current = "";
      onChange(undefined);
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      // Record what this commit will serialize to, so recognising it on the way
      // back is an exact string comparison rather than a guess.
      committed.current = JSON.stringify(parsed, null, 2);
      onChange(parsed);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Invalid JSON";
    }
  };

  const errorId = handle.id ? `${handle.id}-error` : undefined;
  const showError = touched && error !== null;

  return (
    <>
      <textarea
        {...handle}
        className="ff-panel__input ff-panel__input--json"
        rows={rows ?? 6}
        value={text}
        spellCheck={false}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? errorId : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setError(commit(e.target.value));
        }}
        onBlur={(e) => {
          setTouched(true);
          setError(commit(e.target.value));
        }}
      />
      {showError && (
        <p className="ff-panel__issue ff-panel__issue--field" id={errorId} role="alert">
          ⚠ {error}
        </p>
      )}
    </>
  );
}
