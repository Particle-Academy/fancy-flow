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
import { JsonEditor, type JsonValue } from "@particle-academy/react-fancy";
import type {
  ConfigFieldRenderContext,
  ConfigFieldRenderFn,
} from "../components/NodeConfigPanel/ConfigFieldRenderer";

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
