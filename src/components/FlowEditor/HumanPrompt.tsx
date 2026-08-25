import { useEffect, useId, useRef, useState } from "react";
import type { HumanField, HumanFieldType } from "./human-fields";

/** What the modal was asked to collect — a form, or a yes/no decision. */
export type HumanPromptRequest =
  | { kind: "input"; title: string; submitLabel?: string; fields: HumanField[]; resolve: (values: Record<string, unknown>) => void }
  | { kind: "approval"; title: string; description?: string; resolve: (approved: boolean) => void };

export {
  humanInputFields,
  humanFieldType,
  humanFieldOptions,
  HUMAN_FIELD_TYPE_ALIASES,
  type HumanField,
  type HumanFieldType,
  type HumanFieldOption,
} from "./human-fields";

/** The `<input type>` each canonical field renders with. */
const INPUT_TYPE: Partial<Record<HumanFieldType, string>> = {
  text: "text",
  number: "number",
  date: "date",
  datetime: "datetime-local",
  time: "time",
  email: "email",
  url: "url",
  tel: "tel",
  password: "password",
};

/**
 * The value a field starts on, in the type the field will resolve in.
 *
 * A switch starts `false` rather than `""` so the submitted value is a boolean
 * whether or not the person touched it — a form that returns `""` for an
 * untouched checkbox and `true` for a touched one hands the next node two
 * different types for the same field.
 */
function initialValues(fields: HumanField[]): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "switch") {
      v[f.key] = !!f.default;
    } else if (f.type === "number") {
      v[f.key] = typeof f.default === "number" ? f.default : f.default === undefined || f.default === "" ? "" : Number(f.default);
    } else {
      v[f.key] = f.default ?? "";
    }
  }
  return v;
}

/**
 * The in-editor human-input modal. When a run reaches a `user_input` or
 * `human_approval` node, FlowEditor's default executor opens this and BLOCKS the
 * run (the executor returns a Promise) until the person submits — the same
 * async-executor pattern the headless engine already supports. A host that
 * passes its own `user_input` / `human_approval` executor overrides this.
 *
 * ## Why the controls are native elements and not react-fancy primitives
 *
 * Same reason the config panel's are, and it is a hard constraint rather than a
 * preference: `@particle-academy/react-fancy` is an OPTIONAL peer of this
 * package (`peerDependenciesMeta`) and is listed `external` in `tsup.config.ts`.
 * This file ships in the main `.` entry, so importing react-fancy here would
 * make a standalone `npm install @particle-academy/fancy-flow` fail to resolve
 * at import time — and it would break the `--ff-*` token layer a host overrides
 * on `.ff-editor`, because react-fancy's primitives are hardcoded Tailwind
 * palette classes that read no custom properties. See the docblock on
 * `src/fields/react-fancy.tsx` and the one on `tests/panel-labels.test.tsx`.
 *
 * A host that wants react-fancy controls here already has the seam: pass its
 * own `user_input` executor to `<FlowEditor executors={…}>` and render whatever
 * it likes. Host executors are spread last, so they win.
 */

export function HumanPrompt({ request, onCancel }: { request: HumanPromptRequest; onCancel: () => void }) {
  const firstRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="ff-prompt-overlay" role="dialog" aria-modal="true" aria-label={request.title}>
      <div className="ff-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="ff-prompt__title">{request.title}</div>
        {request.kind === "approval" ? (
          <ApprovalBody request={request} onCancel={onCancel} />
        ) : (
          <InputBody request={request} onCancel={onCancel} firstRef={firstRef} />
        )}
      </div>
    </div>
  );
}

function ApprovalBody({ request, onCancel }: { request: Extract<HumanPromptRequest, { kind: "approval" }>; onCancel: () => void }) {
  return (
    <>
      {request.description && <p className="ff-prompt__desc">{request.description}</p>}
      <div className="ff-prompt__actions">
        <button type="button" className="ff-prompt__btn ff-prompt__btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="button" className="ff-prompt__btn ff-prompt__btn--danger" onClick={() => request.resolve(false)}>Deny</button>
        <button type="button" className="ff-prompt__btn ff-prompt__btn--primary" onClick={() => request.resolve(true)}>Approve</button>
      </div>
    </>
  );
}

function InputBody({
  request,
  onCancel,
  firstRef,
}: {
  request: Extract<HumanPromptRequest, { kind: "input" }>;
  onCancel: () => void;
  firstRef: React.RefObject<HTMLElement | null>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(request.fields));
  const set = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));

  // Ids are scoped to this modal instance so two prompts on one page — a split
  // view, a comparison — never share an id and make one label focus the other's
  // control. Keyed by the FIELD, not its position, so an agent that stored
  // `data-ff-field="email"` still finds it after the schema is reordered.
  const uid = useId();
  const fieldId = (key: string) => `${uid}-${key}`;

  const missing = request.fields.filter((f) => f.required && (values[f.key] === undefined || values[f.key] === ""));
  const submit = () => { if (missing.length === 0) request.resolve(values); };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
    >
      <div className="ff-prompt__fields">
        {request.fields.map((f, i) => (
          <div key={f.key} className="ff-prompt__field">
            <label className="ff-prompt__label" htmlFor={fieldId(f.key)}>
              {f.label ?? f.key}
              {/* aria-hidden so the field is announced "Email", not "Email star". */}
              {f.required && <span className="ff-prompt__req" aria-hidden="true"> *</span>}
            </label>
            <FieldControl
              field={f}
              id={fieldId(f.key)}
              value={values[f.key]}
              onChange={(v) => set(f.key, v)}
              autoFocusRef={i === 0 ? firstRef : undefined}
            />
          </div>
        ))}
      </div>
      <div className="ff-prompt__actions">
        <button type="button" className="ff-prompt__btn ff-prompt__btn--ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ff-prompt__btn ff-prompt__btn--primary" disabled={missing.length > 0}>
          {request.submitLabel || "Continue"}
        </button>
      </div>
    </form>
  );
}

/**
 * One control, chosen by the field's canonical type.
 *
 * Every branch is controlled (`value` + `onChange`) and carries the same two
 * handles — the `id` its label points at, and `data-ff-field` keyed by the
 * field — because this modal is a Human+ surface an agent drives through an
 * MCP bridge rather than by guessing at the DOM.
 */
function FieldControl({
  field,
  id,
  value,
  onChange,
  autoFocusRef,
}: {
  field: HumanField;
  id: string;
  value: unknown;
  onChange: (v: unknown) => void;
  autoFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const handle = { id, "data-ff-field": field.key } as const;

  if (field.type === "textarea") {
    return (
      <textarea
        {...handle}
        className="ff-prompt__input"
        placeholder={field.placeholder}
        ref={autoFocusRef as React.RefObject<HTMLTextAreaElement> | undefined}
        rows={3}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (field.type === "switch") {
    return (
      <input
        {...handle}
        type="checkbox"
        className="ff-prompt__switch"
        ref={autoFocusRef as React.RefObject<HTMLInputElement> | undefined}
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }

  if (field.type === "select") {
    // A select stays a select even with nothing to choose. Falling through to a
    // text box — which is what used to happen — hid the authoring mistake AND
    // collected an unconstrained string for a field whose whole point is that
    // the downstream node gets one of a fixed set.
    const options = field.options ?? [];
    return (
      <select
        {...handle}
        className="ff-prompt__input"
        ref={autoFocusRef as React.RefObject<HTMLSelectElement> | undefined}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>{options.length ? "Choose…" : "No choices configured"}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  return (
    <input
      {...handle}
      className="ff-prompt__input"
      placeholder={field.placeholder}
      ref={autoFocusRef as React.RefObject<HTMLInputElement> | undefined}
      type={INPUT_TYPE[field.type ?? "text"] ?? "text"}
      value={String(value ?? "")}
      onChange={(e) =>
        onChange(field.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)
      }
    />
  );
}
