import { useEffect, useRef, useState } from "react";

/**
 * The in-editor human-input modal. When a run reaches a `user_input` or
 * `human_approval` node, FlowEditor's default executor opens this and BLOCKS the
 * run (the executor returns a Promise) until the person submits — the same
 * async-executor pattern the headless engine already supports. A host that
 * passes its own `user_input` / `human_approval` executor overrides this.
 */

/** A field the input modal renders. Mirrors a `user_input` `fields` row. */
export type HumanField = {
  key: string;
  label?: string;
  type?: "text" | "textarea" | "number" | "select" | "switch";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
};

export type HumanPromptRequest =
  | { kind: "input"; title: string; submitLabel?: string; fields: HumanField[]; resolve: (values: Record<string, unknown>) => void }
  | { kind: "approval"; title: string; description?: string; resolve: (approved: boolean) => void };

/**
 * Normalize a `user_input` node's `fields` config into renderable fields. Falls
 * back to a single text field so even an unconfigured User Input node still
 * collects something rather than silently returning nothing.
 */
export function humanInputFields(config: Record<string, unknown>): HumanField[] {
  const raw = Array.isArray((config as any)?.fields) ? ((config as any).fields as any[]) : [];
  const fields: HumanField[] = raw
    .filter((f) => f && typeof f === "object" && typeof (f as any).key === "string" && (f as any).key)
    .map((f: any) => ({
      key: f.key,
      label: typeof f.label === "string" && f.label ? f.label : f.key,
      type: ["text", "textarea", "number", "select", "switch"].includes(f.type) ? f.type : "text",
      required: !!f.required,
      placeholder: typeof f.placeholder === "string" ? f.placeholder : undefined,
      options: Array.isArray(f.options) ? f.options : undefined,
      default: f.default,
    }));
  if (fields.length) return fields;
  const title = typeof (config as any)?.title === "string" && (config as any).title ? (config as any).title : "Your answer";
  return [{ key: "value", label: title, type: "textarea", required: true }];
}

function initialValues(fields: HumanField[]): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const f of fields) v[f.key] = f.type === "switch" ? !!f.default : (f.default ?? "");
  return v;
}

export function HumanPrompt({ request, onCancel }: { request: HumanPromptRequest; onCancel: () => void }) {
  const firstRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
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
  firstRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(request.fields));
  const set = (k: string, v: unknown) => setValues((prev) => ({ ...prev, [k]: v }));

  const missing = request.fields.filter((f) => f.required && (values[f.key] === undefined || values[f.key] === ""));
  const submit = () => { if (missing.length === 0) request.resolve(values); };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
    >
      <div className="ff-prompt__fields">
        {request.fields.map((f, i) => (
          <label key={f.key} className="ff-prompt__field">
            <span className="ff-prompt__label">{f.label ?? f.key}{f.required && <span className="ff-prompt__req"> *</span>}</span>
            {renderControl(f, values[f.key], (v) => set(f.key, v), i === 0 ? firstRef : undefined)}
          </label>
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

function renderControl(
  f: HumanField,
  value: unknown,
  onChange: (v: unknown) => void,
  ref?: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
) {
  const common = { className: "ff-prompt__input", placeholder: f.placeholder };
  if (f.type === "textarea") {
    return (
      <textarea
        {...common}
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        rows={3}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (f.type === "switch") {
    return (
      <input
        type="checkbox"
        className="ff-prompt__switch"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }
  if (f.type === "select" && f.options && f.options.length) {
    return (
      <select className="ff-prompt__input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>Choose…</option>
        {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <input
      {...common}
      ref={ref as React.RefObject<HTMLInputElement>}
      type={f.type === "number" ? "number" : "text"}
      value={String(value ?? "")}
      onChange={(e) => onChange(f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
    />
  );
}
