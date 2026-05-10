import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { categoryAccent, listNodeKinds, onNodeKindsChanged } from "../../registry/registry";
import type { NodeCategory, NodeKindDefinition } from "../../registry/types";

export type NodePaletteProps = {
  /** Filter to only these categories. */
  categories?: NodeCategory[];
  /** Called when the user clicks a kind (in addition to drag). Optional. */
  onPick?: (kind: NodeKindDefinition) => void;
  className?: string;
  style?: CSSProperties;
};

const CATEGORY_ORDER: NodeCategory[] = ["trigger", "logic", "data", "ai", "io", "human", "output", "custom"];
const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: "Triggers",
  logic: "Logic",
  data: "Data",
  ai: "AI",
  io: "Connectors",
  human: "Human",
  output: "Output",
  custom: "Custom",
};

/**
 * NodePalette — sidebar listing every registered node kind, grouped by
 * category. Drag a kind onto a `<FlowCanvas>` to add a new node — set
 * `onDrop` on the canvas to handle the drop with the kind name from the
 * `application/x-fancy-flow-kind` data type.
 */
export function NodePalette({ categories, onPick, className, style }: NodePaletteProps) {
  const [, setRev] = useState(0);
  useEffect(() => onNodeKindsChanged(() => setRev((n) => n + 1)), []);

  const [query, setQuery] = useState("");
  const visibleCats = categories ?? CATEGORY_ORDER;

  const grouped = useMemo(() => {
    const all = listNodeKinds();
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter((k) => k.name.includes(q) || k.label.toLowerCase().includes(q) || (k.description ?? "").toLowerCase().includes(q))
      : all;
    const map = new Map<NodeCategory, NodeKindDefinition[]>();
    for (const cat of visibleCats) map.set(cat, []);
    for (const k of filtered) {
      if (!map.has(k.category)) map.set(k.category, []);
      map.get(k.category)!.push(k);
    }
    return map;
  }, [query, visibleCats]);

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
