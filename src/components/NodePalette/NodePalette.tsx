import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { categoryAccent, listNodeKinds, onNodeKindsChanged } from "../../registry/registry";
import type { NodeCategory, NodeKindDefinition } from "../../registry/types";

export type NodePaletteProps = {
  /** Filter to only these categories. */
  categories?: NodeCategory[];
  /**
   * Presentation-only visibility policy for KINDS. Returning `false` omits the
   * row, leaving the registered kind and its runtime behaviour untouched — the
   * same contract `fieldFilter` has on `NodeConfigPanel`, one level up.
   *
   * `categories` cannot express this. A host that supports a subset of the
   * vocabulary is the normal case, not an exotic one: a runtime with no way to
   * RESUME a paused run has to keep `human_approval` / `user_input` /
   * `rich_user_input` out of the palette, and those three sit in a category
   * alongside nothing else it wants to hide.
   *
   * Without it the only lever was `overrideNodeKind` to re-categorise the
   * host's OWN nodes until a category filter happened to exclude ours — which
   * distorts the host's taxonomy to work around a gap in ours. A consumer
   * reported doing exactly that analysis and filing instead (#14).
   *
   * Deliberately a predicate over the full definition rather than a list of
   * ids: it has to serve custom kinds a host registered and kinds vendored in
   * from the marketplace, whose names the palette cannot know in advance.
   */
  kindFilter?: (context: { kind: NodeKindDefinition }) => boolean;
  /** Called when the user clicks a kind (in addition to drag). Optional. */
  onPick?: (kind: NodeKindDefinition) => void;
  className?: string;
  style?: CSSProperties;
};

const CATEGORY_ORDER: NodeCategory[] = ["trigger", "logic", "data", "ai", "io", "human", "output", "layout", "annotation", "custom"];
const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: "Triggers",
  logic: "Logic",
  data: "Data",
  ai: "AI",
  io: "Connectors",
  human: "Human",
  output: "Output",
  layout: "Layout",
  annotation: "Notes",
  custom: "Custom",
};

/**
 * NodePalette — sidebar listing every registered node kind, grouped by
 * category. Drag a kind onto a `<FlowCanvas>` to add a new node — set
 * `onDrop` on the canvas to handle the drop with the kind name from the
 * `application/x-fancy-flow-kind` data type.
 */
export function NodePalette({ categories, kindFilter, onPick, className, style }: NodePaletteProps) {
  const [, setRev] = useState(0);
  useEffect(() => onNodeKindsChanged(() => setRev((n) => n + 1)), []);

  const [query, setQuery] = useState("");
  const visibleCats = categories ?? CATEGORY_ORDER;

  const grouped = useMemo(() => {
    const all = listNodeKinds();
    const q = query.trim().toLowerCase();
    // Host policy first, then the user's search. Applying the search first
    // would let a hidden kind reappear the moment somebody typed its name --
    // which is the one moment a host hiding an unsupported kind most needs it
    // to stay hidden.
    const allowed = kindFilter ? all.filter((k) => kindFilter({ kind: k })) : all;
    const filtered = q
      ? allowed.filter((k) => k.name.includes(q) || k.label.toLowerCase().includes(q) || (k.description ?? "").toLowerCase().includes(q))
      : allowed;
    const map = new Map<NodeCategory, NodeKindDefinition[]>();
    for (const cat of visibleCats) map.set(cat, []);
    for (const k of filtered) {
      if (!map.has(k.category)) map.set(k.category, []);
      map.get(k.category)!.push(k);
    }
    return map;
  }, [query, visibleCats, kindFilter]);

  return (
    <aside className={["ff-palette", className ?? ""].filter(Boolean).join(" ")} style={style}>
      <div className="ff-palette__search">
        <input
          className="ff-palette__search-input"
          placeholder="Search nodes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="ff-palette__list">
        {Array.from(grouped.entries()).map(([cat, kinds]) =>
          kinds.length === 0 ? null : (
            <section key={cat} className="ff-palette__group">
              <header className="ff-palette__group-label">{CATEGORY_LABELS[cat] ?? cat}</header>
              {kinds.map((k) => (
                <KindRow key={k.name} kind={k} onPick={onPick} />
              ))}
            </section>
          ),
        )}
      </div>
    </aside>
  );
}

function KindRow({ kind, onPick }: { kind: NodeKindDefinition; onPick?: (k: NodeKindDefinition) => void }) {
  const accent = kind.accent ?? categoryAccent(kind.category);
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-fancy-flow-kind", kind.name);
    // Setting both lets non-aware drop targets (e.g. text inputs) ignore it cleanly.
    e.dataTransfer.setData("text/plain", kind.name);
  };
  return (
    <button
      type="button"
      className="ff-palette__row"
      draggable
      onDragStart={onDragStart}
      onClick={() => onPick?.(kind)}
      title={kind.description ?? kind.name}
    >
      <span className="ff-palette__row-dot" style={{ background: accent }}>{kind.icon ?? ""}</span>
      <span className="ff-palette__row-text">
        <span className="ff-palette__row-label">{kind.label}</span>
        {kind.description && <span className="ff-palette__row-desc">{kind.description}</span>}
      </span>
    </button>
  );
}

/**
 * useDropFromPalette — wires the canvas drop target. Returns the drop /
 * dragOver handlers; they parse the dragged kind name and call `onDrop`
 * with `(kindName, position)` in viewport coords.
 */
export function paletteDropHandlers(onDrop: (kindName: string, evt: React.DragEvent) => void) {
  return {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("application/x-fancy-flow-kind")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop: (e: React.DragEvent) => {
      const name = e.dataTransfer.getData("application/x-fancy-flow-kind");
      if (!name) return;
      e.preventDefault();
      onDrop(name, e);
    },
  };
}
