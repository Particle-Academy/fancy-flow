import { memo, useEffect, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { FlowNode } from "../../types";
import { useFlowEditorOptional } from "../FlowEditor/api";

/**
 * NoteNode — a sticky-note annotation. A portless, visual-only node: nothing
 * wires to it and the engine skips it entirely, so a note NEVER reaches a
 * runner — its text lives in the document purely for people reading the canvas
 * and for editor / agent (MCP) tools. Wired as the `@particle-academy/note`
 * kind's `component`, so `buildNodeTypes` uses it instead of the default card;
 * also the legacy `defaultNodeTypes.note` renderer.
 *
 * Inside a `<FlowEditor>` the note is editable in place — double-click to type;
 * commits flow through `api.updateNode`, so each is one undoable step. In a
 * read-only viewer (no editor context) it renders as static text. Text is read
 * from `config.text` (canonical), falling back to the legacy `data.body` shape.
 */

type NoteColor = "amber" | "sky" | "violet" | "emerald" | "rose" | "slate";

/** Soft sticky-note fills that read in both light and dark. */
const NOTE_COLORS: Record<NoteColor, { bg: string; border: string; title: string }> = {
  amber:   { bg: "rgba(234, 179, 8, 0.14)",  border: "rgba(234, 179, 8, 0.55)",  title: "#a16207" },
  sky:     { bg: "rgba(14, 165, 233, 0.12)", border: "rgba(14, 165, 233, 0.5)",  title: "#0369a1" },
  violet:  { bg: "rgba(139, 92, 246, 0.13)", border: "rgba(139, 92, 246, 0.5)",  title: "#6d28d9" },
  emerald: { bg: "rgba(16, 185, 129, 0.13)", border: "rgba(16, 185, 129, 0.5)",  title: "#047857" },
  rose:    { bg: "rgba(244, 63, 94, 0.12)",  border: "rgba(244, 63, 94, 0.5)",   title: "#be123c" },
  slate:   { bg: "rgba(100, 116, 139, 0.12)", border: "rgba(100, 116, 139, 0.5)", title: "#475569" },
};

function coerceColor(v: unknown): NoteColor {
  return typeof v === "string" && v in NOTE_COLORS ? (v as NoteColor) : "amber";
}

function NoteNodeInner(props: NodeProps<FlowNode>) {
  const data = props.data as any;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const api = useFlowEditorOptional();

  const hasConfigText = typeof config.text === "string" && config.text.length > 0;
  // config.text is canonical; legacy notes carried their text in `data.body`.
  const text = hasConfigText
    ? String(config.text)
    : typeof data.body === "string"
      ? data.body
      : typeof data.text === "string"
        ? data.text
        : "";
  // config.title is canonical; a legacy note used its `data.label` as the title.
  const title =
    (typeof config.title === "string" && config.title) ||
    (!hasConfigText && typeof data.body === "string" && typeof data.label === "string" ? data.label : "");
  const skin = NOTE_COLORS[coerceColor(config.color)];

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && areaRef.current) {
      const el = areaRef.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (!api || draft === text) return;
    const current = api.nodes.find((n) => n.id === props.id);
    if (!current) return;
    api.updateNode({
      ...current,
      data: { ...(current.data as any), config: { ...config, text: draft } },
    } as FlowNode);
  };

  return (
    <div
      className={["ff-note", props.selected ? "ff-note--selected" : ""].filter(Boolean).join(" ")}
      style={{ background: skin.bg, borderColor: skin.border }}
      onDoubleClick={api ? () => { setDraft(text); setEditing(true); } : undefined}
    >
      <NodeResizer isVisible={props.selected ?? false} color={skin.border} minWidth={140} minHeight={80} />
      {title && <div className="ff-note__title" style={{ color: skin.title }}>{title}</div>}
      {editing ? (
        <textarea
          ref={areaRef}
          className="ff-note__input nodrag nowheel"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
          }}
        />
      ) : (
        <div className="ff-note__body">
          {text || <span className="ff-note__placeholder">{api ? "Double-click to write a note…" : "Note"}</span>}
        </div>
      )}
    </div>
  );
}

export const NoteNode = memo(NoteNodeInner);
