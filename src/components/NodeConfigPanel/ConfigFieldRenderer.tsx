import { type ReactNode, useMemo } from "react";
import type {
  ConfigField,
  KeyValueConfigField,
  RepeaterConfigField,
  TextConfigField,
} from "../../registry/types";

export type ConfigFieldRendererProps = {
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
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
};

/**
 * ConfigFieldRenderer — dispatches to the right input element per field
 * type. Plain HTML inputs styled via the package's CSS so the package
 * stays standalone (no react-fancy import required).
 *
 * Hosts that want to use react-fancy form components can supply their
 * own field renderers via the kind's `renderPanel`.
 */
export function ConfigFieldRenderer({
  field,
  value,
  onChange,
  renderCredentialField,
  renderDocumentField,
}: ConfigFieldRendererProps) {
  switch (field.type) {
    case "text": {
      // Declaring `choices` turns a text field into a picker without changing
      // its type or the shape of the value it stores.
      if (field.choices?.length) {
        return <ChoiceField field={field} value={value} onChange={onChange} />;
      }
      return (
        <input
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
      return <JsonField value={value} onChange={onChange} rows={field.rows} />;

    case "expression":
      return (
        <textarea
          className="ff-panel__input ff-panel__input--expression"
          rows={2}
          value={(value as string) ?? ""}
          placeholder={field.example ?? "{{ $json.field }}"}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
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
          field={field}
          value={value}
          onChange={onChange}
          renderCredentialField={renderCredentialField}
          renderDocumentField={renderDocumentField}
        />
      );

    case "keyvalue":
      return <KeyValueField field={field} value={value} onChange={onChange} />;

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
  field,
  value,
  onChange,
  renderCredentialField,
  renderDocumentField,
}: {
  field: RepeaterConfigField;
  value: unknown;
  onChange: (v: unknown) => void;
  renderCredentialField?: ConfigFieldRendererProps["renderCredentialField"];
  renderDocumentField?: ConfigFieldRendererProps["renderDocumentField"];
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
    <div className="ff-repeater" data-ff-repeater={field.key}>
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
                field={sub}
                value={row[sub.key]}
                onChange={(cell) => setCell(i, sub.key, cell)}
                renderCredentialField={renderCredentialField}
                renderDocumentField={renderDocumentField}
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
  field,
  value,
  onChange,
}: {
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
    <div className="ff-keyvalue" data-ff-keyvalue={field.key}>
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

function JsonField({ value, onChange, rows }: { value: unknown; onChange: (v: unknown) => void; rows?: number }) {
  // Keep a separate string buffer so partial input doesn't get clobbered
  // by re-serializing on every keystroke.
  const initial = useMemo(() => {
    try {
      return value === undefined ? "" : JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }, [value]);
  return (
    <textarea
      className="ff-panel__input ff-panel__input--json"
      rows={rows ?? 6}
      defaultValue={initial}
      spellCheck={false}
      onBlur={(e) => {
        const text = e.target.value.trim();
        if (text === "") {
          onChange(undefined);
          return;
        }
        try {
          onChange(JSON.parse(text));
        } catch {
          // Leave value unchanged; visual stays at last good state on next render
        }
      }}
    />
  );
}
