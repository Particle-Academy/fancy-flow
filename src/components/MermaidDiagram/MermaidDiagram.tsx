import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { fromMermaid } from "../../mermaid/parse";
import type { MermaidDirection, MermaidLimits, MermaidNodeMeta, MermaidReport } from "../../mermaid/types";
import { FlowViewer } from "../FlowViewer/FlowViewer";
import { useResolvedColorMode, type FlowColorModeInput } from "../canvas/use-resolved-color-mode";
import { MermaidDirections, MermaidNode } from "./MermaidNode";
import { mermaidDiagramHeight, mermaidEdgeView } from "./view";
import type { FlowGraph } from "../../types";

export type MermaidDiagramView = "diagram" | "source";
export type MermaidDiagramStatus = "ok" | "partial" | "unsupported" | "error" | "empty";

/** Writes the source to the clipboard. Throwing, rejecting or returning `false` is a failed copy. */
export type MermaidClipboardWriter = (text: string) => void | boolean | Promise<void | boolean>;

export interface MermaidDiagramProps {
  /** Mermaid source. Only flowcharts are drawn; any other type shows as source with a notice. */
  source: string;
  id?: string;
  /** Controlled view. Pair with `onViewChange`. */
  view?: MermaidDiagramView;
  /** Uncontrolled starting view. Default `diagram`. */
  defaultView?: MermaidDiagramView;
  /** Called when the toggle asks for the other view. Under `view`, the host decides. */
  onViewChange?: (view: MermaidDiagramView) => void;
  /** Override the importer's limits (input size, nodes, edges, label length, nesting). */
  limits?: Partial<MermaidLimits>;
  /** Canvas height in px. Unset: follows the container's width and the diagram's proportions. */
  height?: number;
  /** Bounds for the automatic height. Defaults 160 and 560. */
  minHeight?: number;
  maxHeight?: number;
  /** Pins light or dark. Unset follows the app (`.dark`, `data-theme`, then the OS). */
  colorMode?: FlowColorModeInput;
  /** Pan/zoom/fit controls. Default true. */
  showControls?: boolean;
  /** A bare wheel zooms. Default false, so a diagram mid-page never traps scrolling (Shift+wheel zooms). */
  zoomOnWheel?: boolean;
  /** The copy-source button. Default true. */
  showCopy?: boolean;
  clipboardWriter?: MermaidClipboardWriter;
  /** Called after every copy attempt. */
  onCopy?: (event: { text: string; ok: boolean }) => void;
  /** The importer's report, whenever the source or limits change. */
  onReport?: (report: MermaidReport) => void;
  /** Accessible name for the diagram. Default "Mermaid diagram". */
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
}

const FEEDBACK_MS = 2000;
const NODE_TYPES = { note: MermaidNode };

async function defaultWriter(text: string): Promise<void> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip || typeof clip.writeText !== "function") throw new Error("Clipboard unavailable");
  await clip.writeText(text);
}

function statusOf(graph: FlowGraph | null, report: MermaidReport): MermaidDiagramStatus {
  if (graph) return report.complete ? "ok" : "partial";
  if (report.diagramType === "empty") return "empty";
  return report.supported ? "error" : "unsupported";
}

function noticeFor(status: MermaidDiagramStatus, report: MermaidReport): string | null {
  const firstError = report.issues.find((i) => i.severity === "error");
  switch (status) {
    case "unsupported":
      return report.diagramType === "unknown"
        ? "This diagram type is not supported yet. Showing the source."
        : `Mermaid ${report.diagramType} diagrams are not supported yet. Showing the source.`;
    case "error":
      return `This diagram could not be drawn. ${firstError?.message ?? ""} Showing the source.`.replace(/\s+/g, " ");
    case "empty":
      return "There is no diagram to draw.";
    case "partial":
      return "Part of this diagram could not be drawn. What was left out is listed below.";
    default:
      return null;
  }
}

/** Each node's effective direction: its subgraph's `direction`, else the enclosing one's. */
function directions(graph: FlowGraph, base: MermaidDirection): Map<string, MermaidDirection> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, MermaidDirection>();
  // The direction a node is laid out in: its container's own `direction`, else
  // the direction the container itself is laid out in. Same rule as the layout.
  const of = (id: string, depth: number): MermaidDirection => {
    const known = out.get(id);
    if (known) return known;
    const parent = (byId.get(id) as { parentId?: string } | undefined)?.parentId;
    let dir = base;
    if (parent && byId.has(parent) && depth < 64) {
      const meta = (byId.get(parent)!.data as { mermaid?: MermaidNodeMeta } | undefined)?.mermaid;
      dir = meta?.direction ?? of(parent, depth + 1);
    }
    out.set(id, dir);
    return dir;
  };
  for (const n of graph.nodes) of(n.id, 0);
  return out;
}

/**
 * MermaidDiagram — Mermaid source, drawn read-only by `FlowViewer`.
 *
 * Flowcharts are imported with `fromMermaid` (no third-party Mermaid code) and
 * drawn as display-only nodes. Every other diagram type shows its source with a
 * "not supported yet" notice: it is never drawn as something it is not. A
 * flowchart with statements the importer left out is drawn with a notice that
 * lists them.
 *
 * Human+ handles: the root carries `data-mermaid-diagram`, `-status`, `-type`,
 * `-view` and `-width`; the toggle, copy button, notice, issue list and source
 * each carry their own `data-mermaid-diagram-*`; every node carries
 * `data-mermaid-node="<id>"` and `data-mermaid-shape`. The view is controllable
 * with `view` + `onViewChange`.
 */
export function MermaidDiagram({
  source,
  id,
  view: controlledView,
  defaultView = "diagram",
  onViewChange,
  limits,
  height,
  minHeight = 160,
  maxHeight = 560,
  colorMode,
  showControls = true,
  zoomOnWheel = false,
  showCopy = true,
  clipboardWriter,
  onCopy,
  onReport,
  ariaLabel = "Mermaid diagram",
  className,
  style,
}: MermaidDiagramProps) {
  const limitsKey = JSON.stringify(limits ?? {});
  const { graph, report } = useMemo(
    () => fromMermaid(source, { limits: JSON.parse(limitsKey) as Partial<MermaidLimits> }),
    [source, limitsKey],
  );

  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;
  useEffect(() => {
    onReportRef.current?.(report);
  }, [report]);

  const status = statusOf(graph, report);
  const [uncontrolledView, setUncontrolledView] = useState<MermaidDiagramView>(defaultView);
  const view: MermaidDiagramView = graph ? (controlledView ?? uncontrolledView) : "source";
  const requestView = (next: MermaidDiagramView) => {
    if (controlledView === undefined) setUncontrolledView(next);
    onViewChange?.(next);
  };

  // Container-aware sizing: the canvas takes the diagram's proportions at the
  // width it is actually given.
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const resolvedMode = useResolvedColorMode(colorMode);
  const markerId = "ff-mmd-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const view_ = useMemo(() => {
    if (!graph) return null;
    return {
      graph: { nodes: graph.nodes, edges: graph.edges.map((e) => mermaidEdgeView(e, markerId)) } as FlowGraph,
      directions: directions(graph, graph.mermaid?.direction ?? "TB"),
    };
  }, [graph, markerId]);

  const canvasHeight = height ?? (graph ? mermaidDiagramHeight(graph, width ?? 640, { min: minHeight, max: maxHeight }) : minHeight);

  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    let ok: boolean;
    try {
      ok = (await (clipboardWriter ?? defaultWriter)(source)) !== false;
    } catch {
      ok = false;
    }
    setCopyState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("idle"), FEEDBACK_MS);
    onCopy?.({ text: source, ok });
  };

  const notice = noticeFor(status, report);
  const listed = report.issues.filter((i) => i.severity !== "info");

  return (
    <div
      ref={rootRef}
      id={id}
      role="figure"
      aria-label={ariaLabel}
      className={["ff-mermaid", resolvedMode === "dark" ? "dark" : "ff-canvas--light", className ?? ""].filter(Boolean).join(" ")}
      style={style}
      data-mermaid-diagram=""
      data-mermaid-diagram-status={status}
      data-mermaid-diagram-type={report.diagramType}
      data-mermaid-diagram-view={view}
      data-mermaid-diagram-width={width ?? undefined}
      data-color-mode={colorMode && colorMode !== "system" ? colorMode : undefined}
    >
      <div className="ff-mermaid__toolbar">
        {graph && (
          <button
            type="button"
            className="ff-mermaid__button"
            data-mermaid-diagram-toggle=""
            aria-pressed={view === "source"}
            onClick={() => requestView(view === "diagram" ? "source" : "diagram")}
          >
            {view === "diagram" ? "Show source" : "Show diagram"}
          </button>
        )}
        {showCopy && (
          <button
            type="button"
            className="ff-mermaid__button"
            data-mermaid-diagram-copy=""
            data-copy-state={copyState}
            onClick={() => void copy()}
          >
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy source"}
          </button>
        )}
      </div>

      {notice && (
        <div className="ff-mermaid__notice" role="status" data-mermaid-diagram-notice="">
          {notice}
        </div>
      )}

      {listed.length > 0 && (
        <details className="ff-mermaid__issues" open={status === "partial"}>
          <summary>{listed.length === 1 ? "1 note on this diagram" : `${listed.length} notes on this diagram`}</summary>
          <ul data-mermaid-diagram-issues="">
            {listed.map((issue, k) => (
              <li key={k} data-mermaid-issue={issue.code} data-severity={issue.severity}>
                {issue.line ? `On line ${issue.line}: ` : ""}
                {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {view === "diagram" && view_ ? (
        <MermaidDirections.Provider value={view_.directions}>
          <svg className="ff-mermaid__markers" width="0" height="0" aria-hidden focusable="false">
            <defs>
              <marker id={`${markerId}-circle`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
                <circle cx="5" cy="5" r="4" />
              </marker>
              <marker id={`${markerId}-cross`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
                <path d="M2 1 L8 9 M8 1 L2 9" />
              </marker>
            </defs>
          </svg>
          <FlowViewer
            graph={view_.graph}
            nodeTypes={NODE_TYPES}
            colorMode={colorMode}
            height={canvasHeight}
            showControls={showControls}
            zoomOnWheel={zoomOnWheel}
            fitOnResize
            className="ff-mermaid__canvas"
          />
        </MermaidDirections.Provider>
      ) : (
        <pre className="ff-mermaid__source">
          <code data-mermaid-diagram-source="">{source}</code>
        </pre>
      )}
    </div>
  );
}

export interface MermaidFenceProps {
  /** The code between the fences. */
  code: string;
  /** The fence's language, lower-cased (`mermaid`). */
  language?: string;
  /** The whole info string after the fence. */
  info?: string;
}

/**
 * A react-fancy `ContentRenderer` fence renderer:
 * `<ContentRenderer fences={{ mermaid: MermaidFence }} />`.
 */
export function MermaidFence({ code }: MermaidFenceProps) {
  return <MermaidDiagram source={code} />;
}
