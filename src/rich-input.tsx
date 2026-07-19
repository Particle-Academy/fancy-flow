/**
 * `@particle-academy/fancy-flow/rich-input` — wires `rich_user_input` to the
 * real CMS.
 *
 * Import this entry once, anywhere in your app, and the node lights up:
 *
 * ```ts
 * import "@particle-academy/fancy-flow/rich-input";
 * ```
 *
 * ## Why this is a separate entry
 *
 * The document a rich input step shows IS a fancy-cms page — same `PageDoc`,
 * same renderer, same editor. fancy-flow declares no document schema of its
 * own and never re-implements one; duplicating the model would guarantee the
 * two drift, and a step authored in fancy-flow would stop being a thing
 * fancy-cms could open.
 *
 * But most flows never use a rich input, and a workflow editor should not drag
 * a CMS into every install. So the dependency lives HERE, on an opt-in
 * subpath, instead of in the main entry. `@particle-academy/fancy-cms-ui` and
 * `@particle-academy/react-fancy` are optional peers: required to import this
 * module, irrelevant if you never do.
 */
import { createElement } from "react";
import { CmsPage, Editor, emptyDoc, type PageDoc } from "@particle-academy/fancy-cms-ui";
import { FauxClient } from "@particle-academy/react-fancy";
import { registerRichInputAdapter } from "./registry/rich-input";

export type { PageDoc };

/**
 * A blank page for a step that hasn't been authored yet.
 *
 * `Editor` takes a `defaultValue`, not a nullable doc — so a never-authored
 * step needs a real empty document to open into rather than a blank screen.
 */
export function emptyRichInputDoc(id = "rich-input"): PageDoc {
  return emptyDoc(id);
}

/** True when a stored value is a fancy-cms page document. */
export function isPageDoc(value: unknown): value is PageDoc {
  if (value === null || typeof value !== "object") return false;
  const v = value as Partial<PageDoc>;
  return Array.isArray(v.sections) && typeof v.nodes === "object" && v.nodes !== null;
}

/**
 * Register fancy-cms as the document engine for `rich_user_input`.
 *
 * Called automatically on import. Exported so a host can re-register after
 * swapping in a custom element registry, and so the call is testable.
 */
export function useFancyCmsForRichInput(options: {
  /** Custom element registry — pass the SAME one you give `CmsPage` at runtime,
   *  or the edit canvas renders your node types as blank placeholders. */
  registry?: Parameters<typeof CmsPage>[0]["registry"];
  /** Data context that `{ $bind }` props preview against. */
  data?: Parameters<typeof CmsPage>[0]["data"];
} = {}): () => void {
  return registerRichInputAdapter({
    FauxClient,
    // Render the page at a real desktop width and scale it down, rather than
    // letting it reflow into a card-sized viewport — a preview that reflows
    // shows a layout the person hitting the step will never see.
    frameProps: { variant: "browser", width: 1280, scale: "fit", dots: true },

    // Preview: the CMS's own renderer, so the node card shows exactly what the
    // person hitting this step will see. Styles are scoped by the frame.
    renderDocument: (doc) =>
      isPageDoc(doc)
        ? createElement(CmsPage, { doc, registry: options.registry, data: options.data })
        : null,

    // Authoring: the CMS's own WYSIWYG editor, in the config panel.
    renderEditor: ({ value, onChange }) =>
      createElement(Editor, {
        defaultValue: isPageDoc(value) ? value : emptyRichInputDoc(),
        onChange: onChange as (doc: PageDoc) => void,
        registry: options.registry,
        data: options.data,
      }),
  });
}

useFancyCmsForRichInput();
