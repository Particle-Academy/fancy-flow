import type { ReactNode } from "react";

/**
 * Rich user input — the adapter seam.
 *
 * `rich_user_input` pauses a run on a fully authored page (long-form content,
 * required reading + confirmation, multi-section forms) rather than a flat
 * field list. Authoring and rendering that document needs a document model
 * (fancy-cms Stages) and a device frame for the preview (react-fancy's
 * FauxClient) — neither of which fancy-flow depends on.
 *
 * So the host registers them once, and the node lights up:
 *
 * ```tsx
 * import { FauxClient } from "@particle-academy/react-fancy";
 * import { StagesViewer } from "@particle-academy/fancy-cms-ui";
 * import { registerRichInputAdapter } from "@particle-academy/fancy-flow";
 *
 * registerRichInputAdapter({
 *   FauxClient,
 *   renderDocument: (doc) => <StagesViewer doc={doc} />,
 * });
 * ```
 *
 * Until then the node still registers and still round-trips its config — it
 * just renders an "unavailable" body explaining what to install. Keeping the
 * dependency optional is deliberate: fancy-cms is an early-release beta, and a
 * workflow editor should not hard-require a CMS to draw a canvas.
 */
export type RichInputAdapter = {
  /**
   * react-fancy's `FauxClient` (or any component with the same shape) — a
   * frame that mimics a browser window or device and scales its content down
   * to fit. Used to preview the authored page inside the node card.
   */
  FauxClient?: (props: {
    variant?: "browser" | "device" | "bare";
    children?: ReactNode;
    [key: string]: unknown;
  }) => ReactNode;
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
          Needs a document adapter. Install{" "}
          <code>@particle-academy/fancy-cms-ui</code> +{" "}
          <code>@particle-academy/react-fancy</code>, then call{" "}
          <code>registerRichInputAdapter()</code>.
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
        {Frame ? <Frame variant="browser">{body}</Frame> : body}
      </div>
    </div>
  );
}
