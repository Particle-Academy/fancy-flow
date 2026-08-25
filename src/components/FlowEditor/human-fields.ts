/**
 * The field vocabulary a `user_input` node declares, and the normalizer that
 * turns whatever was actually written into something renderable.
 *
 * ## Why this is a separate module from `HumanPrompt.tsx`
 *
 * `src/registry/builtin.ts` needs `humanFieldType` for the `user_input` kind's
 * `outputShape`, and `builtin.ts` is in the import graph of the `/engine`
 * entry — the one `tests/core-nodes.test.ts` guards as React-free so a queue
 * worker or a CLI can register kinds without dragging React in. Importing the
 * modal's `.tsx` from there put a React module on that path and left the guard
 * standing only because treeshaking happened to drop it.
 *
 * Pure functions over plain data, in a `.ts` file, so the headless path cannot
 * regress on a future edit to the component.
 */

/**
 * The control a field renders as, after {@link humanInputFields} has resolved
 * whatever the author, a peer runtime or an agent actually wrote.
 *
 * These are the CANONICAL names. The vocabulary an author may write is wider —
 * see {@link HUMAN_FIELD_TYPE_ALIASES} — because a `fields` array arrives from
 * three places (the config panel, a hand-written workflow JSON, and the PHP /
 * Python runtimes) and each has its own habits for spelling "boolean".
 */
export type HumanFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "switch"
  | "date"
  | "datetime"
  | "time"
  | "email"
  | "url"
  | "tel"
  | "password";

/** One choice in a `select` field, after normalization. */
export type HumanFieldOption = { value: string; label: string };

/** A field the input modal renders. Mirrors a `user_input` `fields` row. */
export type HumanField = {
  key: string;
  label?: string;
  type?: HumanFieldType;
  required?: boolean;
  placeholder?: string;
  options?: HumanFieldOption[];
  default?: unknown;
};

/**
 * Every spelling of a field type this accepts, mapped onto its canonical
 * control.
 *
 * The bug this table exists to fix: the old normalizer accepted exactly five
 * literal names and coerced everything else to `text`, so `boolean`, `date`,
 * `email` and `enum` — the words a person reaches for first, and the words the
 * peer runtimes' own docs use — all arrived at the form as a plain text box.
 * The person then typed a date into a text field and the run resumed with a
 * string where a date was declared, which nothing downstream could detect.
 *
 * Aliases rather than a stricter schema because the declaration is DATA. It is
 * written by hand and emitted by agents, and rejecting `boolean` on a spelling
 * technicality would be a worse failure than accepting it.
 */
export const HUMAN_FIELD_TYPE_ALIASES: Readonly<Record<string, HumanFieldType>> = {
  text: "text",
  string: "text",
  str: "text",
  input: "text",

  textarea: "textarea",
  long_text: "textarea",
  longtext: "textarea",
  "long-text": "textarea",
  multiline: "textarea",
  paragraph: "textarea",
  markdown: "textarea",

  number: "number",
  numeric: "number",
  integer: "number",
  int: "number",
  float: "number",
  decimal: "number",

  select: "select",
  enum: "select",
  choice: "select",
  choices: "select",
  dropdown: "select",
  options: "select",
  radio: "select",

  switch: "switch",
  bool: "switch",
  boolean: "switch",
  checkbox: "switch",
  toggle: "switch",

  date: "date",

  datetime: "datetime",
  "datetime-local": "datetime",
  datetimelocal: "datetime",
  timestamp: "datetime",

  time: "time",

  email: "email",
  "e-mail": "email",

  url: "url",
  uri: "url",
  link: "url",

  tel: "tel",
  phone: "tel",
  telephone: "tel",

  password: "password",
  secret: "password",
};

/**
 * Resolve a declared type name to a control.
 *
 * An unrecognised name becomes `text` — never a crash and never a dropped
 * field. A field the form refuses to render is a value the run will never
 * receive, which is strictly worse than rendering it as free text.
 */
export function humanFieldType(raw: unknown): HumanFieldType {
  if (typeof raw !== "string") return "text";
  return HUMAN_FIELD_TYPE_ALIASES[raw.trim().toLowerCase()] ?? "text";
}

/**
 * Normalize whatever an author wrote for a select's choices.
 *
 * Accepts the three shapes that actually turn up:
 *
 * - `["small", "large"]` — bare strings, the shorthand `TextConfigField.choices`
 *   already accepts elsewhere in this package.
 * - `[{ value: "s", label: "Small" }]` — the explicit form.
 * - `{ s: "Small", l: "Large" }` — what the config panel's `keyvalue` control
 *   stores, which is how choices are authored on the `user_input` node.
 *
 * A missing `label` falls back to the value rather than rendering an empty
 * option — the old code read `o.label` off a bare string and put `undefined`
 * into both the value and the text, so a shorthand list rendered as a dropdown
 * of blank rows.
 */
export function humanFieldOptions(raw: unknown): HumanFieldOption[] | undefined {
  const entries: HumanFieldOption[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" || typeof item === "number") {
        const value = String(item);
        if (value !== "") entries.push({ value, label: value });
        continue;
      }
      if (item && typeof item === "object") {
        const value = (item as { value?: unknown }).value;
        if (value === undefined || value === null || value === "") continue;
        const label = (item as { label?: unknown }).label;
        entries.push({
          value: String(value),
          label: typeof label === "string" && label !== "" ? label : String(value),
        });
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [value, label] of Object.entries(raw as Record<string, unknown>)) {
      if (value === "") continue;
      entries.push({ value, label: typeof label === "string" && label !== "" ? label : value });
    }
  }

  return entries.length ? entries : undefined;
}

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
      type: humanFieldType(f.type),
      required: !!f.required,
      placeholder: typeof f.placeholder === "string" ? f.placeholder : undefined,
      options: humanFieldOptions(f.options ?? f.choices),
      default: f.default,
    }));
  if (fields.length) return fields;
  const title = typeof (config as any)?.title === "string" && (config as any).title ? (config as any).title : "Your answer";
  return [{ key: "value", label: title, type: "textarea", required: true }];
}

