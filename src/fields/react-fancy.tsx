/**
 * `@particle-academy/fancy-flow/fields/react-fancy` — richer config fields for
 * hosts that already run react-fancy.
 *
 * ```tsx
 * import { reactFancyFieldRenderers } from "@particle-academy/fancy-flow/fields/react-fancy";
 *
 * <FlowEditor … fieldRenderers={reactFancyFieldRenderers} />
 * ```
 *
 * ## Why an opt-in subpath rather than the panel itself
 *
 * fancy-flow themes every surface through a `--ff-*` custom-property layer that
 * a host overrides on `.ff-editor`. react-fancy's primitives are hardcoded
 * Tailwind palette classes and read no custom properties — so building them
 * into the panel would trade the theming contract for a nicer widget, which is
 * the trade `panel-labels.test.tsx` already decided against.
 *
 * Making it a subpath keeps both: react-fancy stays an OPTIONAL peer, a
 * standalone install pays nothing, and a Tailwind host opts in with one prop.
 * Same shape as `/llm/vercel-ai` and `/rich-input`.
 *
 * ## What it currently covers
 *
 * Just `json`, because that is the only built-in whose fallback is a raw
 * textarea. The others are already purpose-built controls; replacing them would
 * be churn. This is a map, so a host can spread it and add their own:
 *
 * ```tsx
 * fieldRenderers={{ ...reactFancyFieldRenderers, "trigger-filters": myRenderer }}
 * ```
 */
import {
  DatePicker,
  Input,
  JsonEditor,
  Select,
  Switch,
  Textarea,
  type JsonValue,
} from "@particle-academy/react-fancy";
import type {
  ConfigFieldRenderContext,
  ConfigFieldRenderFn,
} from "../components/NodeConfigPanel/ConfigFieldRenderer";
import type { HumanFieldRenderers } from "../components/FlowEditor/HumanPrompt";

/**
 * Render a `json` config field as a react-fancy `JsonEditor`.
 *
 * Returns `null` for every other field type — the seam treats `null` as "not
 * mine", so this can be handed over wholesale without claiming controls it has
 * no business replacing.
 */
export const jsonFieldRenderer: ConfigFieldRenderFn = ({
  field,
  value,
  onChange,
  id,
}: ConfigFieldRenderContext) => {
  if (field.type !== "json") return null;

  return (
    // JSX rather than `createElement` for one concrete reason: `data-*` props
    // are special-cased by JSX but hit excess-property checking in a
    // `createElement` object literal, so the agent handle would not typecheck.
    <JsonEditor
      // The panel's `<label htmlFor>` points at this id, and the Human+
      // contract wants a stable handle an agent can target without guessing at
      // the DOM. Both reach the editor's root element via its rest spread.
      id={id}
      data-ff-field={field.key}
      value={(value ?? {}) as JsonValue}
      onChange={(next: JsonValue) => onChange(next)}
      // `keyMap` is what makes this more than a prettier textarea: it declares
      // a type per path, which picks the control and reports contradictions. A
      // string by design, so it survives an MCP round-trip.
      keyMap={field.keyMap}
      mode="edit"
      size="sm"
      rootLabel={field.label}
    />
  );
};

/**
 * The full renderer map. Spread it to add your own types alongside.
 */
export const reactFancyFieldRenderers: Record<string, ConfigFieldRenderFn> = {
  json: jsonFieldRenderer,
};

/* ------------------------------------------------------------------------- *
 * Pause-form controls
 * ------------------------------------------------------------------------- */

/**
 * react-fancy controls for the `user_input` / `human_approval` pause form.
 *
 * ```tsx
 * import { humanFieldRenderers } from "@particle-academy/fancy-flow/fields/react-fancy";
 *
 * <FlowEditor … humanFieldRenderers={humanFieldRenderers} />
 * ```
 *
 * ## Why this is opt-in rather than the default
 *
 * Rule 2 of the suite says our surfaces compose react-fancy rather than
 * hand-rolling what a primitive already covers, and the pause form's built-ins
 * are native elements. That is not a gap in the kit — react-fancy has every
 * primitive needed — it is a PACKAGING constraint: react-fancy is an OPTIONAL
 * peer, `HumanPrompt` ships in the main entry, and importing it there would
 * make a standalone `npm install @particle-academy/fancy-flow` fail to resolve
 * at import time while bypassing the `--ff-*` token layer hosts theme
 * `.ff-editor` with.
 *
 * This map is how a host that HAS react-fancy gets the Fancy controls anyway,
 * with one prop and no cost to anyone else. Same shape and same reasoning as
 * `reactFancyFieldRenderers` above.
 *
 * ## What it covers, and what it deliberately does not
 *
 * `datetime` is absent: react-fancy's `DatePicker` is date-only, so claiming
 * the type here would render a control that silently drops the time half of a
 * value the field promised to collect. It falls through to the built-in
 * `<input type="datetime-local">`, which does collect it. An honest gap beats a
 * control that looks right and loses data.
 */
export const humanFieldRenderers: HumanFieldRenderers = {
  text: ({ field, id, value, onChange, autoFocusRef }) => (
    <Input
      id={id}
      data-ff-field={field.key}
      ref={autoFocusRef as React.RefObject<HTMLInputElement> | undefined}
      placeholder={field.placeholder}
      value={String(value ?? "")}
      onValueChange={onChange}
    />
  ),

  textarea: ({ field, id, value, onChange, autoFocusRef }) => (
    <Textarea
      id={id}
      data-ff-field={field.key}
      ref={autoFocusRef as React.RefObject<HTMLTextAreaElement> | undefined}
      placeholder={field.placeholder}
      rows={3}
      value={String(value ?? "")}
      onValueChange={onChange}
    />
  ),

  number: ({ field, id, value, onChange, autoFocusRef }) => (
    <Input
      id={id}
      data-ff-field={field.key}
      ref={autoFocusRef as React.RefObject<HTMLInputElement> | undefined}
      type="number"
      placeholder={field.placeholder}
      value={String(value ?? "")}
      // The built-in resolves a number field to a NUMBER, so this must too --
      // the value here is what resumes the paused run, and handing the next
      // node "41" where it resolved 41 before is a silent type change that no
      // test downstream would attribute to a renderer swap.
      onValueChange={(v) => onChange(v === "" ? "" : Number(v))}
    />
  ),

  select: ({ field, id, value, onChange }) => (
    <Select
      id={id}
      data-ff-field={field.key}
      list={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
      value={String(value ?? "")}
      onValueChange={onChange}
    />
  ),

  switch: ({ field, id, value, onChange }) => (
    <Switch
      id={id}
      data-ff-field={field.key}
      checked={!!value}
      onCheckedChange={onChange}
    />
  ),

  date: ({ field, id, value, onChange }) => (
    <DatePicker
      id={id}
      data-ff-field={field.key}
      value={String(value ?? "")}
      onValueChange={onChange}
    />
  ),
};

/*
 * `time` and `datetime` are ABSENT on purpose, and for different reasons.
 *
 * `datetime`: react-fancy's `DatePicker` is date-only. Claiming the type here
 * would render a control that silently drops the time half of a value the field
 * promised to collect.
 *
 * `time`: `TimePicker` accepts NO `id` and no `data-*` passthrough --
 * `TimePickerProps` is a closed interface of nine props, none of them an
 * identifier. It therefore cannot satisfy the two handles every control in this
 * form owes: the `id` its `<label htmlFor>` points at, and the `data-ff-field`
 * an agent drives the surface by. Wrapping it in a handle-bearing div would put
 * the label on a non-focusable element, which is worse than not claiming it.
 *
 * Both fall through to the built-in `<input type="time">` /
 * `<input type="datetime-local">`, which do carry the handles and do collect
 * the whole value. An honest gap beats a control that looks right and loses
 * either data or its handle.
 *
 * The `TimePicker` half is a react-fancy FINDING rather than a fancy-flow
 * limitation -- per the suite's second rule, a missing primitive capability is
 * filed against the kit rather than routed around locally.
 */
