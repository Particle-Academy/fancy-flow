import type { ComponentType, ReactNode } from "react";

/**
 * Rich user input — the injection point.
 *
 * `rich_user_input` pauses a run on a fully authored page (long-form content,
 * required reading + confirmation, multi-section forms) rather than a flat
 * field list. That page IS a fancy-cms document — fancy-flow defines no
 * document schema of its own and never re-implements one.
 *
 * The wiring ships in the box. Import the subpath once and the node lights up:
 *
 * ```ts
 * import "@particle-academy/fancy-flow/rich-input";
 * ```
 *
 * That module registers fancy-cms's `PageDoc` + `CmsPage` renderer + `Editor`
 * against this seam. It lives on a separate entry so `@particle-academy/
 * fancy-cms-ui` and `@particle-academy/react-fancy` stay OPTIONAL peers — most
 * flows never use a rich input, and a workflow editor should not drag a CMS
 * into every install.
 *
 * The seam stays public so a host can substitute a different document engine,
 * but that is the escape hatch, not the expected path.
 *
 * Until something registers, the node still registers and still round-trips
 * its config — it renders a "how to enable" body rather than an empty card.
 */
export type RichInputAdapter = {
  /**
   * react-fancy's `FauxClient` (or any component with the same shape) — a
   * frame that mimics a browser window or device and scales its content down
   * to fit. Used to preview the authored page inside the node card.
   */
  FauxClient?: ComponentType<any>;
  /**
   * Props for the frame — e.g. `{ variant: "browser", width: 1280, scale: "fit" }`
   * so a full-width page renders at its real width and scales down into the
   * node card instead of reflowing to a cramped layout that misrepresents it.
   */
  frameProps?: Record<string, unknown>;
  /** Render the stored document read-only, for the in-node preview. */
  renderDocument?: (doc: unknown) => ReactNode;
  /** Editor mounted in the config panel via `renderDocumentField`. */
  renderEditor?: (props: { value: unknown; onChange: (next: unknown) => void }) => ReactNode;
};

let adapter: RichInputAdapter | null = null;
const listeners = new Set<() => void>();

/** Install the host's document editor + preview frame. Returns an unregister fn. */
export function registerRichInputAdapter(next: RichInputAdapter): () => void {
  adapter = next;
  for (const l of listeners) l();
  return () => {
    if (adapter === next) {
      adapter = null;
      for (const l of listeners) l();
    }
  };
}

/** The registered adapter, or null when the host hasn't wired one. */
export function getRichInputAdapter(): RichInputAdapter | null {
  return adapter;
}

/** True once a host has wired an adapter — i.e. the node is usable. */
export function isRichInputEnabled(): boolean {
  return adapter !== null && (adapter.renderDocument !== undefined || adapter.renderEditor !== undefined);
}

/** Subscribe to adapter changes (so nodes re-render when it lands). */
export function onRichInputAdapterChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * RichInputPreview — the node card body. Shows the authored page inside a
 * FauxClient frame so an author can see, at a glance on the canvas, what the
 * person hitting this step will be looking at.
 *
 * Degrades in two steps rather than one: no adapter at all → install hint;
 * adapter but nothing authored yet → an empty frame with the step title. A
 * blank node body would read as "broken" in both cases.
 */
export function RichInputPreview({ config }: { config: Record<string, unknown> }) {
  const a = getRichInputAdapter();
  const title = typeof config.title === "string" && config.title.trim() !== "" ? config.title : "Untitled step";
  const doc = config.document;

  if (!a || (!a.renderDocument && !a.renderEditor)) {
    return (
      <div className="ff-rich-preview">
        <span className="ff-rich-preview__title">{title}</span>
        <div className="ff-rich-preview__unavailable">
          Add <code>@particle-academy/fancy-cms-ui</code> +{" "}
          <code>@particle-academy/react-fancy</code>, then{" "}
          <code>import "@particle-academy/fancy-flow/rich-input"</code>.
        </div>
      </div>
    );
  }

  const body = doc === undefined || doc === null
    ? <p className="ff-rich-preview__unavailable">Nothing authored yet.</p>
    : a.renderDocument?.(doc) ?? null;

  const Frame = a.FauxClient;

  return (
    <div className="ff-rich-preview">
      <span className="ff-rich-preview__title">{title}</span>
      <div className="ff-rich-preview__frame">
        {Frame ? <Frame {...(a.frameProps ?? { variant: "browser" })}>{body}</Frame> : body}
      </div>
    </div>
  );
}
