import { type ReactNode, useMemo } from "react";
import type { ConfigField } from "../../registry/types";

export type ConfigFieldRendererProps = {
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
  renderCredentialField?: (props: {
    credentialType: string;
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
export function ConfigFieldRenderer({ field, value, onChange, renderCredentialField }: ConfigFieldRendererProps) {
  switch (field.type) {
    case "text":
      return (
        <input
          className="ff-panel__input"
          type="text"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

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

    default:
      return null;
  }
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
